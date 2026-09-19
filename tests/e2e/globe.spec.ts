import { expect, test } from '@playwright/test'
import { STAR_FIELDS, type Star } from '../../src/types/catalog'

const stars: Partial<Star>[] = [
  { id: 700051, proper: 'Étoile A', ra: 6, dec: 12, mag: 1 },
  { id: 700052, proper: 'Étoile B', ra: 18, dec: -12, mag: 1 },
  { id: 700053, proper: 'Étoile C', ra: 8, dec: 20, mag: 2 },
]
const catalogue = {
  schemaVersion: 1,
  columns: STAR_FIELDS,
  metadata: {
    name: 'Catalogue fictif',
    version: '1',
    count: stars.length,
    epoch: 'J2000',
    license: 'CC0',
    licenseUrl: 'https://example.invalid/license',
    source: 'https://example.invalid/catalogue',
    revision: 'test',
    sourceSha256: 'test',
    excludedSun: 0,
    fields: STAR_FIELDS.length,
  },
  rows: stars.map((star) => STAR_FIELDS.map((field) => star[field] ?? null)),
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`globe supports rotation, zoom, hit testing and returning to the plane at ${viewport.width}px`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize(viewport)
    await page.route('**/data/stars.json*', (route) => route.fulfill({ json: catalogue }))
    await page.goto('/')
    const canvas = page.locator('canvas.sky-map__canvas')
    await expect.poll(() => page.locator('.map-loading-label').count()).toBe(0)
    const coordinates = page.locator('.map-coordinates')
    const original = await coordinates.textContent()
    const settings = page.getByRole('button', { name: 'Réglages d’affichage', exact: true })
    await settings.click()
    const projection = page.getByRole('combobox', { name: 'Projection', exact: true })
    await expect(projection).toHaveValue('plane')
    await projection.selectOption('globe')
    await page.keyboard.press('Escape')
    await expect(page.locator('.sky-map--globe')).toBeVisible()
    const box = (await canvas.boundingBox())!
    await canvas.click({ position: { x: 5, y: 5 } })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } })
    await expect(page.getByRole('tooltip')).toHaveText('Étoile A')
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } })
    await expect(page.getByRole('heading', { name: 'Étoile A', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Fermer la fiche' }).click()
    await canvas.focus()
    await canvas.press('ArrowRight')
    await canvas.press('ArrowUp')
    await expect(coordinates).not.toHaveText(original ?? '')
    await canvas.press('=')
    await canvas.press('Home')
    await expect(coordinates).toContainText('+12°')
    await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } })
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 35, { steps: 5 })
    await page.mouse.up()
    await expect(coordinates).not.toHaveText(original ?? '')
    const beforePinch = await coordinates.textContent()
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 1, x: box.x + box.width / 2 - 30, y: box.y + box.height / 2 },
        { id: 2, x: box.x + box.width / 2 + 30, y: box.y + box.height / 2 },
      ],
    })
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { id: 1, x: box.x + box.width / 2 - 30, y: box.y + box.height / 2 },
        { id: 2, x: box.x + box.width / 2 + 90, y: box.y + box.height / 2 },
      ],
    })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await session.detach()
    await expect(coordinates).not.toHaveText(beforePinch ?? '')
    const search = page.getByRole('combobox', {
      name: 'Rechercher une étoile ou une constellation',
      exact: true,
    })
    if (!(await search.isVisible()))
      await page.getByRole('button', { name: 'Rechercher et régler la carte' }).click()
    await search.fill('Étoile B')
    await page.getByRole('option', { name: /Étoile B/ }).click()
    await expect(page.getByRole('heading', { name: 'Étoile B', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Fermer la fiche' }).click()
    await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } })
    await expect(page.getByRole('tooltip')).toHaveText('Étoile B')
    await settings.click()
    await projection.selectOption('plane')
    await page.keyboard.press('Escape')
    await expect(page.locator('.sky-map--globe')).toHaveCount(0)
    await expect(coordinates).toHaveText(original ?? '')
    expect(errors).toEqual([])
  })
}

test('globe remains usable without WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        return kind === 'webgl' ? null : Reflect.apply(original, this, [kind, ...args])
      },
    })
  })
  await page.route('**/data/stars.json*', (route) => route.fulfill({ json: catalogue }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Réglages d’affichage', exact: true }).click()
  await page.getByRole('combobox', { name: 'Projection', exact: true }).selectOption('globe')
  await page.keyboard.press('Escape')
  const canvas = page.locator('canvas.sky-map__canvas')
  const box = (await canvas.boundingBox())!
  await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } })
  await expect(page.getByRole('tooltip')).toHaveText('Étoile A')
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } })
  await expect(page.getByRole('heading', { name: 'Étoile A', exact: true })).toBeVisible()
})
