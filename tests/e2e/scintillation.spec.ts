import { expect, test, type Locator, type Page } from '@playwright/test'
import { STAR_FIELDS, type Star } from '../../src/types/catalog'

const stars: Partial<Star>[] = [
  { id: 700011, proper: 'Étoile A', ra: 5.5, dec: 10, mag: 2, ci: -0.3 },
  { id: 700012, proper: 'Étoile B', ra: 6, dec: 16, mag: 2, ci: 1.6 },
  { id: 700013, proper: 'Étoile C', ra: 6.5, dec: 10, mag: 2 },
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

interface DrawingState {
  clears: number
  arcs: { x: number; y: number; radius: number }[]
}

type InstrumentedWindow = Window & { scintillationDrawing: DrawingState }

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
  await dialog.getByRole('button', { name: `Associer ${name} à l’énigme ${slot}` }).click()
  await expect(dialog).not.toBeVisible()
}

function points(page: Page): Locator {
  return page.locator('.star-scintillation__point')
}

async function glowColors(page: Page): Promise<string[]> {
  return points(page).evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).getPropertyValue('--star-color').trim()),
  )
}

async function glowPositions(page: Page): Promise<{ x: number; y: number }[]> {
  return points(page).evaluateAll((elements) => {
    const canvas = document.querySelector('canvas.sky-map__canvas')
    if (!canvas) throw new Error('Map canvas is missing')
    const map = canvas.getBoundingClientRect()
    return elements.map((element) => {
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x + bounds.width / 2 - map.x, y: bounds.y + bounds.height / 2 - map.y }
    })
  })
}

async function expectAlignedGlows(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const positions = await glowPositions(page)
      const { arcs } = await page.evaluate(
        () => (window as unknown as InstrumentedWindow).scintillationDrawing,
      )
      const bounds = await page.locator('canvas.sky-map__canvas').boundingBox()
      if (!bounds) return false
      const visible = positions.filter(
        ({ x, y }) => x >= 0 && x <= bounds.width && y >= 0 && y <= bounds.height,
      )
      return (
        visible.length > 0 &&
        visible.every((point) =>
          arcs.some((arc) => arc.radius > 5 && Math.hypot(arc.x - point.x, arc.y - point.y) < 0.1),
        )
      )
    })
    .toBe(true)
}

async function dragMap(page: Page, dx: number, dy: number): Promise<void> {
  const bounds = await page.locator('canvas.sky-map__canvas').boundingBox()
  if (!bounds) throw new Error('Map canvas has no bounds')
  const strokes = Math.max(
    1,
    Math.ceil(Math.abs(dx) / (bounds.width * 0.6)),
    Math.ceil(Math.abs(dy) / (bounds.height * 0.6)),
  )
  const start = {
    x: bounds.x + bounds.width * (dx < 0 ? 0.8 : 0.2),
    y: bounds.y + bounds.height * (dy < 0 ? 0.8 : 0.2),
  }
  for (let stroke = 0; stroke < strokes; stroke += 1) {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + dx / strokes, start.y + dy / strokes, { steps: 4 })
    await page.mouse.up()
  }
}

test.beforeEach(async ({ page }) => {
  await page.route('**/data/stars.json*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogue) }),
  )
  await page.addInitScript(() => {
    const state: DrawingState = { clears: 0, arcs: [] }
    Object.defineProperty(window, 'scintillationDrawing', { get: () => state })
    const prototype = CanvasRenderingContext2D.prototype
    const clearRect = prototype.clearRect
    const arc = prototype.arc
    prototype.clearRect = function (...args) {
      if (this.canvas.classList.contains('sky-map__canvas')) {
        state.clears += 1
        state.arcs = []
      }
      return clearRect.apply(this, args)
    }
    prototype.arc = function (...args) {
      if (this.canvas.classList.contains('sky-map__canvas')) {
        state.arcs.push({ x: args[0], y: args[1], radius: args[2] })
      }
      return arc.apply(this, args)
    }
  })
})

test('assigned stars shine in their displayed colors, survive reload and remain clickable', async ({
  page,
}) => {
  await page.goto('/')
  await expect(searchField(page)).toBeEnabled()
  await expect(points(page)).toHaveCount(0)
  for (const [index, star] of stars.entries()) await assignStar(page, star.proper!, index + 1)
  await expect(points(page)).toHaveCount(3)

  const panel = page.getByRole('region', { name: /Mes étoiles/i })
  const palette = await panel
    .locator('.is-filled .slot-number')
    .evaluateAll((elements) =>
      elements.map((element) =>
        getComputedStyle(element).getPropertyValue('--assigned-color').trim(),
      ),
    )
  await expect.poll(async () => (await glowColors(page)).sort()).toEqual([...palette].sort())
  expect(new Set(palette).size).toBe(3)
  const blue = palette[0]!
  const orange = palette[1]!
  expect(Number.parseInt(blue.slice(5, 7), 16)).toBeGreaterThan(
    Number.parseInt(blue.slice(1, 3), 16),
  )
  expect(Number.parseInt(orange.slice(1, 3), 16)).toBeGreaterThan(
    Number.parseInt(orange.slice(5, 7), 16),
  )
  expect(palette[2]).toBe('#e5e7eb')
  await expect(page.locator('.star-scintillation')).toHaveAttribute('aria-hidden', 'true')
  await expect(points(page).first()).toHaveCSS('pointer-events', 'none')

  const bluePoint = points(page).first()
  const position = await bluePoint.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  })
  await page.mouse.click(position.x, position.y)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Étoile A', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Fermer la fiche' }).click()
  await expect(dialog).not.toBeVisible()

  await page.reload()
  await expect(searchField(page)).toBeEnabled()
  await expect(points(page)).toHaveCount(3)
  await expect.poll(async () => (await glowColors(page)).sort()).toEqual([...palette].sort())
  await panel.getByRole('button', { name: 'Retirer Étoile B de l’énigme 2' }).click()
  await expect(points(page)).toHaveCount(2)
  expect(await glowColors(page)).not.toContain(orange)
})

test('scintillation animates while the sky canvas stays idle', async ({ page }) => {
  await page.goto('/')
  await assignStar(page, 'Étoile A', 1)
  await expect(points(page)).toHaveCount(1)
  await page.mouse.move(5, 5)
  const result = await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    const root = document.querySelector('.star-scintillation')
    if (!root) throw new Error('Scintillation layer is missing')
    const appearance = () =>
      [...root.querySelectorAll('.star-scintillation__point > *')].map((element) => {
        const style = getComputedStyle(element)
        return `${style.opacity}/${style.transform}`
      })
    const drawing = (window as unknown as InstrumentedWindow).scintillationDrawing
    const before = { appearance: appearance(), clears: drawing.clears }
    const activeAnimations = root
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === 'running').length
    await new Promise((resolve) => window.setTimeout(resolve, 350))
    return { before, after: { appearance: appearance(), clears: drawing.clears }, activeAnimations }
  })
  expect(result.activeAnimations).toBeGreaterThan(0)
  expect(result.after.appearance).not.toEqual(result.before.appearance)
  expect(result.after.clears).toBe(result.before.clears)
})

test('glow centers track the canvas through panning, zooming and pole crossings', async ({
  page,
}) => {
  await page.goto('/')
  await assignStar(page, 'Étoile A', 1)
  const canvas = page.locator('canvas.sky-map__canvas')
  await expect(points(page)).toHaveCount(1)
  await expectAlignedGlows(page)
  const initial = (await glowPositions(page))[0]!
  await canvas.focus()
  await canvas.press('ArrowRight')
  await canvas.press('ArrowDown')
  await expect
    .poll(async () => {
      const point = (await glowPositions(page))[0]!
      return Math.hypot(point.x - (initial.x - 55), point.y - (initial.y - 55))
    })
    .toBeLessThan(0.1)
  await expectAlignedGlows(page)
  await canvas.press('=')
  await expect
    .poll(async () => {
      const point = (await glowPositions(page))[0]!
      return Math.hypot(point.x - (initial.x - 82.5), point.y - (initial.y - 82.5))
    })
    .toBeLessThan(0.1)
  await expectAlignedGlows(page)
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Map canvas has no bounds')
  await dragMap(page, -bounds.width, 0)
  await expect(points(page)).toHaveCount(0)
  await dragMap(page, bounds.width, 0)
  await expect(points(page)).toHaveCount(1)
  await expectAlignedGlows(page)
  for (let step = 0; step < 7; step += 1) await canvas.press('-')
  await expectAlignedGlows(page)
  const coordinates = page.locator('.map-coordinates')
  const beforeCrossing = (await coordinates.textContent()) ?? ''
  await dragMap(page, 0, bounds.width * 0.5)
  await expect(coordinates).not.toHaveText(beforeCrossing)
  await expectAlignedGlows(page)
  expect(await points(page).count()).toBeGreaterThan(0)
})

test('reduced motion keeps assigned stars luminous without animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await assignStar(page, 'Étoile A', 1)
  await expect(points(page)).toHaveCount(1)
  const state = await page.locator('.star-scintillation').evaluate((element) => ({
    animations: element.getAnimations({ subtree: true }).length,
    layers: [
      ...element.querySelectorAll('.star-scintillation__core, .star-scintillation__halo'),
    ].map((layer) => {
      const style = getComputedStyle(layer)
      return {
        animation: style.animationName,
        opacity: Number(style.opacity),
        visibility: style.visibility,
      }
    }),
  }))
  expect(state.animations).toBe(0)
  expect(state.layers).toHaveLength(2)
  for (const layer of state.layers) {
    expect(layer.animation).toBe('none')
    expect(layer.opacity).toBeGreaterThan(0)
    expect(layer.visibility).toBe('visible')
  }
  await expectAlignedGlows(page)
})
