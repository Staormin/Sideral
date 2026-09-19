import { expect, test, type Locator, type Page } from '@playwright/test'
import { STAR_FIELDS, type Star } from '../../src/types/catalog'

const storageKey = 'sideral.star-assignments.v1'
const names = ['Étoile A', 'Étoile B', 'Étoile C', 'Étoile D'] as const
const catalogue = {
  schemaVersion: 1,
  columns: STAR_FIELDS,
  metadata: {
    name: 'Catalogue fictif',
    version: '1',
    count: names.length,
    epoch: 'J2000',
    license: 'CC0',
    licenseUrl: 'https://example.invalid/license',
    source: 'https://example.invalid/catalogue',
    revision: 'test',
    sourceSha256: 'test',
    excludedSun: 0,
    fields: STAR_FIELDS.length,
  },
  rows: names.map((proper, index) => {
    const star: Partial<Star> = {
      id: 700001 + index,
      proper,
      ra: 2 + index * 4,
      dec: index * 5,
      mag: 1 + index,
    }
    return STAR_FIELDS.map((field) => star[field] ?? null)
  }),
}

function searchField(page: Page): Locator {
  return page.getByRole('combobox', {
    name: 'Rechercher une étoile ou une constellation',
    exact: true,
  })
}

async function openStar(page: Page, name: string): Promise<Locator> {
  const search = searchField(page)
  if (!(await search.isVisible())) {
    await page.getByRole('button', { name: 'Rechercher et régler la carte' }).click()
  }
  await expect(search).toBeEnabled()
  await search.fill(name)
  await page.getByRole('option', { name: new RegExp(name) }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible()
  return dialog
}

async function closeDetails(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Fermer la fiche' }).click()
  await expect(dialog).not.toBeVisible()
}

async function assignmentPanel(page: Page): Promise<Locator> {
  const panel = page.getByRole('region', { name: /Mes étoiles/i })
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Rechercher et régler la carte' }).click()
  }
  await expect(panel).toBeVisible()
  return panel
}

function assignedStar(panel: Locator, slot: number, name: string): Locator {
  return panel
    .getByRole('listitem')
    .nth(slot - 1)
    .getByText(name, { exact: true })
}

async function savedAssignments(page: Page): Promise<unknown> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), storageKey)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/data/stars.json*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogue) }),
  )
})

test('both return links restore the map when the URL already points to it', async ({ page }) => {
  for (const name of ['Carte', 'Revenir à la carte']) {
    await page.goto('/#enigmes')
    const reader = page.getByRole('main', { name: 'Énigmes', exact: true })
    await expect(reader).toBeVisible()
    await page.evaluate(() => window.history.replaceState(null, '', '#carte'))
    await page.getByRole('link', { name, exact: true }).click()
    await expect(reader).not.toBeVisible()
    await expect(page.locator('canvas.sky-map__canvas')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Carte', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
  }
})

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`riddles page preserves the map and choices at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const canvas = page.locator('canvas.sky-map__canvas')
    await expect(page.locator('input[role="combobox"]')).toBeEnabled()
    const initialCoordinates = await page.locator('.map-coordinates').textContent()
    await canvas.focus()
    await canvas.press('ArrowRight')
    await expect(page.locator('.map-coordinates')).not.toHaveText(initialCoordinates!)
    const coordinates = await page.locator('.map-coordinates').textContent()
    const rasterSize = await canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement
      return { width: canvas.width, height: canvas.height }
    })
    const trigger = page.getByRole('link', { name: 'Énigmes', exact: true })
    await trigger.focus()
    await trigger.press('Enter')
    const reader = page.getByRole('main', { name: 'Énigmes', exact: true })
    await expect(reader).toBeVisible()
    await expect(page).toHaveURL(/#enigmes$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(canvas).not.toBeVisible()
    // Let ResizeObserver and the delayed raster refresh run while the map is hidden.
    await page.waitForTimeout(200)
    expect(
      await canvas.evaluate((element) => {
        const canvas = element as HTMLCanvasElement
        return { width: canvas.width, height: canvas.height }
      }),
    ).toEqual(rasterSize)
    let previousBottom = 0
    for (const slot of [1, 2, 3]) {
      const article = reader.getByRole('article', { name: `Énigme ${slot}`, exact: true })
      const bounds = await article.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(previousBottom)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
      previousBottom = bounds!.y + bounds!.height
    }
    await reader.getByRole('article', { name: 'Énigme 3', exact: true }).scrollIntoViewIfNeeded()
    const illustration = reader.getByRole('img', { name: 'Inscription à déchiffrer' })
    await expect(illustration).toBeVisible()
    await expect(illustration).toHaveJSProperty('naturalWidth', 2814)
    const imageBounds = await illustration.boundingBox()
    expect(imageBounds!.x).toBeGreaterThanOrEqual(0)
    expect(imageBounds!.x + imageBounds!.width).toBeLessThanOrEqual(viewport.width)
    await reader.getByRole('link', { name: 'Revenir à la carte' }).click()
    await expect(reader).not.toBeVisible()
    await expect(canvas).toBeVisible()
    await expect(page.locator('.map-coordinates')).toHaveText(coordinates!)
    await page.goBack()
    await expect(reader).toBeVisible()
    await page.reload()
    await expect(reader).toBeVisible()
    expect(await savedAssignments(page)).toBeNull()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('personal assignments close the details and can be replaced and moved without duplication', async ({
  page,
}) => {
  await page.goto('/')
  await expect(searchField(page)).toBeEnabled()
  const panel = await assignmentPanel(page)
  for (const slot of [1, 2, 3]) await expect(panel).toContainText(`Énigme ${slot}`)
  await expect(panel.getByRole('button', { name: /^Consulter / })).toHaveCount(0)

  let dialog = await openStar(page, 'Étoile A')
  await dialog.getByRole('button', { name: 'Associer Étoile A à l’énigme 1' }).click()
  await expect(dialog).not.toBeVisible()
  await expect.poll(() => savedAssignments(page)).toEqual([700001, null, null])
  await expect(assignedStar(panel, 1, 'Étoile A')).toBeVisible()
  await assignedStar(panel, 1, 'Étoile A').click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('link', { name: 'Énigmes', exact: true }).click()
  const reader = page.getByRole('main', { name: 'Énigmes', exact: true })
  await expect(reader.getByRole('article', { name: 'Énigme 1', exact: true })).toContainText(
    'Étoile A',
  )
  await page.getByRole('link', { name: 'Carte', exact: true }).click()
  await expect(reader).not.toBeVisible()
  await expect(panel.getByRole('button', { name: /^Consulter / })).toHaveCount(0)

  dialog = await openStar(page, 'Étoile B')
  await dialog
    .getByRole('button', { name: 'Remplacer Étoile A par Étoile B pour l’énigme 1' })
    .click()
  await expect(dialog).not.toBeVisible()
  await expect.poll(() => savedAssignments(page)).toEqual([700002, null, null])
  await expect(assignedStar(panel, 1, 'Étoile B')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toHaveCount(0)

  dialog = await openStar(page, 'Étoile B')
  await dialog.getByRole('button', { name: 'Associer Étoile B à l’énigme 2' }).click()
  await expect(dialog).not.toBeVisible()
  await expect.poll(() => savedAssignments(page)).toEqual([null, 700002, null])
  await expect(panel.getByRole('button', { name: /^Retirer / })).toHaveCount(1)
  await expect(assignedStar(panel, 2, 'Étoile B')).toBeVisible()

  dialog = await openStar(page, 'Étoile B')
  await expect(
    dialog.getByRole('button', { name: 'Retirer Étoile B de l’énigme 2' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    dialog.getByRole('button', { name: 'Associer Étoile B à l’énigme 1' }),
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(dialog.getByRole('button', { name: 'Annuler', exact: true })).toHaveCount(0)
  await closeDetails(page)
})

test('the three choices survive reload and can be reopened, removed and reassigned', async ({
  page,
}) => {
  await page.goto('/')
  for (const [index, name] of names.slice(0, 3).entries()) {
    const dialog = await openStar(page, name)
    await dialog.getByRole('button', { name: `Associer ${name} à l’énigme ${index + 1}` }).click()
    await expect(dialog).not.toBeVisible()
  }
  await expect.poll(() => savedAssignments(page)).toEqual([700001, 700002, 700003])
  await page.reload()
  await expect(searchField(page)).toBeEnabled()
  const panel = await assignmentPanel(page)
  for (const [index, name] of names.slice(0, 3).entries()) {
    await expect(assignedStar(panel, index + 1, name)).toBeVisible()
  }

  await panel.getByRole('button', { name: 'Retirer Étoile B de l’énigme 2' }).click()
  await expect(assignedStar(panel, 2, 'Étoile B')).toHaveCount(0)
  await expect.poll(() => savedAssignments(page)).toEqual([700001, null, 700003])
  const dialog = await openStar(page, 'Étoile B')
  await dialog.getByRole('button', { name: 'Associer Étoile B à l’énigme 2' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(assignedStar(panel, 2, 'Étoile B')).toBeVisible()
  await openStar(page, 'Étoile A')
  await closeDetails(page)

  await panel.getByRole('button', { name: 'Retirer Étoile C de l’énigme 3' }).click()
  await page.reload()
  await expect(searchField(page)).toBeEnabled()
  await expect(panel.getByRole('button', { name: /^Retirer / })).toHaveCount(2)
  await expect.poll(() => savedAssignments(page)).toEqual([700001, 700002, null])
})

for (const storage of ['corrupt', 'unavailable'] as const) {
  test(`assignments remain usable when browser storage is ${storage}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(
      ({ key, mode }) => {
        if (mode === 'corrupt') {
          localStorage.setItem(key, '{invalid')
        } else {
          Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() {
              throw new DOMException('Storage unavailable', 'SecurityError')
            },
          })
        }
      },
      { key: storageKey, mode: storage },
    )
    await page.goto('/')
    const dialog = await openStar(page, 'Étoile C')
    await dialog.getByRole('button', { name: 'Associer Étoile C à l’énigme 3' }).click()
    await expect(dialog).not.toBeVisible()
    const panel = await assignmentPanel(page)
    await expect(assignedStar(panel, 3, 'Étoile C')).toBeVisible()
    await panel.getByRole('button', { name: 'Retirer Étoile C de l’énigme 3' }).click()
    await expect(panel.getByRole('button', { name: /^Retirer / })).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('assignment controls fit a narrow mobile screen and support the keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/')
  let dialog = await openStar(page, 'Étoile D')
  for (const slot of [1, 2, 3]) {
    const button = dialog.getByRole('button', { name: `Associer Étoile D à l’énigme ${slot}` })
    await expect(button).toBeVisible()
    const bounds = await button.boundingBox()
    if (!bounds) throw new Error('Assignment control has no bounds')
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(700)
    expect(bounds.height).toBeGreaterThanOrEqual(44)
  }
  const secondSlot = dialog.getByRole('button', { name: 'Associer Étoile D à l’énigme 2' })
  await secondSlot.focus()
  await secondSlot.press('Space')
  await expect(dialog).not.toBeVisible()
  await expect.poll(() => savedAssignments(page)).toEqual([null, 700004, null])
  const panel = await assignmentPanel(page)
  await expect(assignedStar(panel, 2, 'Étoile D')).toBeVisible()
  dialog = await openStar(page, 'Étoile D')
  await expect(dialog).toBeVisible()
  const selected = dialog.getByRole('button', { name: 'Retirer Étoile D de l’énigme 2' })
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  await selected.focus()
  await selected.press('Enter')
  await expect(dialog).toBeVisible()
  await expect(secondSlot).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => savedAssignments(page)).toEqual([null, null, null])
  await secondSlot.focus()
  await secondSlot.press('Space')
  await expect(dialog).not.toBeVisible()
  await assignmentPanel(page)
  await expect(assignedStar(panel, 2, 'Étoile D')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
