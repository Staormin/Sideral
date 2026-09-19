import { expect, test, type Locator, type Page } from '@playwright/test'
import { STAR_FIELDS, type Star } from '../../src/types/catalog'

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

interface CanvasFrame {
  labels: { text: string; x: number; y: number }[]
  segments: { from: [number, number]; to: [number, number] }[]
}

type CanvasWindow = Window & { selectionCanvasFrame: CanvasFrame }

function searchField(page: Page): Locator {
  return page.getByRole('combobox', {
    name: 'Rechercher une étoile ou une constellation',
    exact: true,
  })
}

async function assignStar(page: Page, name: string, slot: number): Promise<void> {
  const search = searchField(page)
  await expect(search).toBeEnabled()
  await search.fill(name)
  await page.getByRole('option', { name: new RegExp(name) }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: `Associer ${name} à l’énigme ${slot}` }).click()
  await expect(dialog).not.toBeVisible()
}

async function currentFrame(page: Page): Promise<CanvasFrame> {
  return page.evaluate(() => (window as unknown as CanvasWindow).selectionCanvasFrame)
}

async function expectVisibleLabels(page: Page, expected: string[]): Promise<void> {
  const bounds = await page.locator('canvas.sky-map__canvas').boundingBox()
  if (!bounds) throw new Error('Map has no visible bounds')
  await expect
    .poll(async () => {
      const frame = await currentFrame(page)
      return expected.every((text) =>
        frame.labels.some(
          (label) =>
            label.text === text &&
            label.x >= 0 &&
            label.x < bounds.width &&
            label.y >= 0 &&
            label.y < bounds.height,
        ),
      )
    })
    .toBe(true)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/data/stars.json*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogue) }),
  )
  await page.addInitScript(() => {
    const prototype = CanvasRenderingContext2D.prototype
    const original = {
      clearRect: prototype.clearRect,
      beginPath: prototype.beginPath,
      moveTo: prototype.moveTo,
      lineTo: prototype.lineTo,
      stroke: prototype.stroke,
      fillText: prototype.fillText,
    }
    let frame: CanvasFrame = { labels: [], segments: [] }
    let path: CanvasFrame['segments'] = []
    let position: [number, number] | null = null
    const isMap = (context: CanvasRenderingContext2D): boolean =>
      context.canvas.classList.contains('sky-map__canvas')
    Object.defineProperty(window, 'selectionCanvasFrame', { get: () => frame })

    prototype.clearRect = function (...args) {
      if (isMap(this)) frame = { labels: [], segments: [] }
      return original.clearRect.apply(this, args)
    }
    prototype.beginPath = function () {
      if (isMap(this)) {
        path = []
        position = null
      }
      return original.beginPath.call(this)
    }
    prototype.moveTo = function (x, y) {
      if (isMap(this)) position = [x, y]
      return original.moveTo.call(this, x, y)
    }
    prototype.lineTo = function (x, y) {
      if (isMap(this)) {
        if (position) path.push({ from: position, to: [x, y] })
        position = [x, y]
      }
      return original.lineTo.call(this, x, y)
    }
    prototype.stroke = function (pathToStroke?: Path2D) {
      if (
        isMap(this) &&
        this.strokeStyle === 'rgba(224, 191, 133, 0.8)' &&
        this.lineWidth === 1.25
      ) {
        frame.segments.push(...path)
      }
      Reflect.apply(original.stroke, this, pathToStroke ? [pathToStroke] : [])
    }
    prototype.fillText = function (...args) {
      if (isMap(this)) frame.labels.push({ text: args[0], x: args[1], y: args[2] })
      return original.fillText.apply(this, args)
    }
  })
})

test('assigned stars draw persistent numbered arcs independently of map layers', async ({
  page,
}) => {
  await page.goto('/')
  await assignStar(page, 'Étoile A', 1)
  await expect.poll(async () => (await currentFrame(page)).segments.length).toBe(0)
  await expectVisibleLabels(page, ['1'])

  await assignStar(page, 'Étoile B', 2)
  await expect.poll(async () => (await currentFrame(page)).segments.length).toBeGreaterThan(2)
  await expectVisibleLabels(page, ['1', '2'])
  const twoStarSegmentCount = (await currentFrame(page)).segments.length

  await assignStar(page, 'Étoile C', 3)
  await expectVisibleLabels(page, ['1', '2', '3'])
  await expect
    .poll(async () => (await currentFrame(page)).segments.length)
    .toBeGreaterThan(twoStarSegmentCount)

  const displaySettings = page.getByRole('button', { name: 'Réglages d’affichage', exact: true })
  await displaySettings.click()
  await expect(displaySettings).toHaveAttribute('aria-expanded', 'true')
  const displayPanel = page.getByRole('region', { name: 'Affichage', exact: true })
  await expect(displayPanel).toBeVisible()
  await displayPanel.getByRole('checkbox', { name: 'Afficher les constellations' }).uncheck()
  await displayPanel.getByRole('checkbox', { name: 'Afficher les noms des étoiles' }).uncheck()
  await displayPanel.getByRole('checkbox', { name: 'Afficher la grille équatoriale' }).uncheck()
  await page.keyboard.press('Escape')
  await expect(displayPanel).not.toBeVisible()
  await expect(displaySettings).toHaveAttribute('aria-expanded', 'false')
  await expectVisibleLabels(page, ['1', '2', '3'])
  await expect
    .poll(async () => (await currentFrame(page)).labels.map(({ text }) => text))
    .toEqual(['1', '2', '3'])
  await expect.poll(async () => (await currentFrame(page)).segments.length).toBeGreaterThan(2)
})

test('selection geometry survives reload, removal and automatic framing after reassignment', async ({
  page,
}) => {
  await page.goto('/')
  for (const [index, name] of names.slice(0, 3).entries()) {
    await assignStar(page, name, index + 1)
  }
  await page.reload()
  await expect(searchField(page)).toBeEnabled()
  await expectVisibleLabels(page, ['1', '2', '3'])

  const panel = page.getByRole('region', { name: /Mes étoiles/i })
  await panel.getByRole('button', { name: 'Retirer Étoile B de l’énigme 2' }).click()
  await expectVisibleLabels(page, ['1', '3'])
  await expect.poll(async () => (await currentFrame(page)).segments.length).toBeGreaterThan(2)
  await expect
    .poll(async () => (await currentFrame(page)).labels.some(({ text }) => text === '2'))
    .toBe(false)
  const canvas = page.locator('canvas.sky-map__canvas')
  await canvas.focus()
  for (let index = 0; index < 6; index += 1) await canvas.press('ArrowRight')
  for (let index = 0; index < 3; index += 1) await canvas.press('ArrowDown')

  await assignStar(page, 'Étoile B', 2)
  await expectVisibleLabels(page, ['1', '2', '3'])
  await expect.poll(async () => (await currentFrame(page)).segments.length).toBeGreaterThan(2)
})
