import { expect, test, type Page } from '@playwright/test'

type AtlasTestWindow = Window & {
  __atlasView?: { ra: number; dec: number; zoom: number }
  __atlasVisibleStarCount?: number
  __VUE_DEVTOOLS_GLOBAL_HOOK__?: {
    enabled: boolean
    emit: (event: string, ...payload: unknown[]) => void
  }
}

test.beforeEach(async ({ page }) => {
  // Observe the map's existing public event without adding test hooks to the app.
  await page.addInitScript(() => {
    const observedWindow = window as AtlasTestWindow
    observedWindow.__VUE_DEVTOOLS_GLOBAL_HOOK__ = {
      enabled: true,
      emit(event, ...payload) {
        const [, , name, args] = payload
        if (event !== 'component:emit' || name !== 'view-change' || !Array.isArray(args)) return
        const view = args[0] as
          { ra: number; dec: number; zoom: number; visibleCount?: unknown } | undefined
        if (view) observedWindow.__atlasView = view
        if (typeof view?.visibleCount === 'number')
          observedWindow.__atlasVisibleStarCount = view.visibleCount
      },
    }
  })
})

async function visibleStarCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as AtlasTestWindow).__atlasVisibleStarCount ?? 0)
}

async function dragMap(page: Page, deltaX: number, deltaY: number): Promise<void> {
  const canvas = page.locator('canvas')
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Canvas not laid out')
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  // Keep fractional, off-screen coordinates exact during captured meridian drags.
  await canvas.dispatchEvent('pointermove', {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    buttons: 1,
    clientX: start.x + deltaX,
    clientY: start.y + deltaY,
  })
  await page.mouse.up()
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}

test('wide-view panning reuses the star raster and preserves visible catalogue entries', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await page.goto('/')
  await expect(
    page.getByRole('combobox', { name: 'Rechercher une étoile ou une constellation', exact: true }),
  ).toBeEnabled({ timeout: 30_000 })
  const canvas = page.locator('canvas')
  await canvas.focus()
  for (let step = 0; step < 4; step += 1) await canvas.press('-')
  await expect
    .poll(() => page.evaluate(() => (window as AtlasTestWindow).__atlasView?.zoom))
    .toBe(1)
  await expect.poll(() => visibleStarCount(page)).toBeGreaterThan(100000)
  const initialCount = await visibleStarCount(page)
  const before = await page.locator('.map-coordinates').textContent()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Canvas not laid out')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  const operations = await canvas.evaluate(async (element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Missing canvas element')
    const ctx = element.getContext('2d')
    if (!ctx) throw new Error('Missing canvas context')
    const fillRect = ctx.fillRect
    const drawImage = ctx.drawImage
    let individualPoints = 0
    let rasterCopies = 0
    ctx.fillRect = function (...args) {
      individualPoints += 1
      return fillRect.apply(this, args)
    }
    ctx.drawImage = function (source: CanvasImageSource, ...coordinates: number[]) {
      rasterCopies += 1
      Reflect.apply(drawImage, this, [source, ...coordinates])
    }
    try {
      const bounds = element.getBoundingClientRect()
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          buttons: 1,
          clientX: bounds.x + bounds.width / 2 - 36,
          clientY: bounds.y + bounds.height / 2,
        }),
      )
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      return { individualPoints, rasterCopies }
    } finally {
      ctx.fillRect = fillRect
      ctx.drawImage = drawImage
    }
  })
  await page.mouse.up()
  await expect(page.locator('.map-coordinates')).not.toHaveText(before ?? '')
  await expect.poll(() => visibleStarCount(page)).toBe(initialCount)
  expect(operations.individualPoints).toBe(0)
  expect(operations.rasterCopies).toBeGreaterThan(0)
  expect(operations.rasterCopies).toBeLessThanOrEqual(8)
  // HYG's Sirius coordinates must still align with the cached image after the pan.
  const center = await page.evaluate(() => (window as AtlasTestWindow).__atlasView!)
  await canvas.click({
    position: {
      x: bounds.width / 2 - ((6.752481 - center.ra) / 24) * bounds.width * center.zoom,
      y: bounds.height / 2 + ((center.dec + 16.716116) / 360) * bounds.width * center.zoom,
    },
  })
  await expect(page.getByRole('heading', { name: 'Sirius', exact: true })).toBeVisible()
})

for (const rendering of ['raster', 'vector'] as const) {
  test(`vertical view stays inside the chart with ${rendering} rendering`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 1000 })
    await page.goto('/')
    await expect(
      page.getByRole('combobox', {
        name: 'Rechercher une étoile ou une constellation',
        exact: true,
      }),
    ).toBeEnabled({ timeout: 30_000 })
    const canvas = page.locator('canvas')
    const readView = () => page.evaluate(() => (window as AtlasTestWindow).__atlasView!)
    async function expectCovered() {
      await expect
        .poll(async () => {
          const center = await readView()
          const bounds = await canvas.boundingBox()
          if (!center || !bounds) return false
          const halfHeight = (180 * bounds.height) / (bounds.width * center.zoom)
          return center.dec + halfHeight <= 90 + 1e-7 && center.dec - halfHeight >= -90 - 1e-7
        })
        .toBe(true)
    }
    await canvas.focus()
    for (let step = 0; step < 8; step++) await canvas.press('-')
    await expectCovered()
    await expect.poll(async () => (await readView()).dec).toBe(0)
    const zoomSteps = rendering === 'vector' ? 3 : 1
    for (let step = 0; step < zoomSteps; step++) await canvas.press('=')
    for (const direction of [1, -1]) {
      await dragMap(page, 0, direction * 100000)
      await expectCovered()
      const boundary = await readView()
      await dragMap(page, 0, direction * 100000)
      await canvas.press(direction === 1 ? 'ArrowUp' : 'ArrowDown')
      expect((await readView()).dec).toBeCloseTo(boundary.dec)
      await dragMap(page, 0, -direction * 30)
      expect((await readView()).dec).not.toBe(boundary.dec)
      await expectCovered()
    }
    await canvas.hover({ position: { x: 100, y: 30 } })
    await page.mouse.wheel(0, 3000)
    await expectCovered()
    await page.setViewportSize({ width: 390, height: 844 })
    await expectCovered()
    await page.setViewportSize({ width: 844, height: 390 })
    await expectCovered()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await canvas.press('Home')
    await expectCovered()
    const center = await readView()
    const bounds = (await canvas.boundingBox())!
    await canvas.click({
      position: {
        x: bounds.width / 2 - ((6.752481 - center.ra) / 24) * bounds.width * center.zoom,
        y: bounds.height / 2 + ((center.dec + 16.716116) / 360) * bounds.width * center.zoom,
      },
    })
    await expect(page.getByRole('heading', { name: 'Sirius', exact: true })).toBeVisible()
  })
}

test('high-zoom grid keeps half-minute labels exact at the north boundary', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('combobox', {
      name: 'Rechercher une étoile ou une constellation',
      exact: true,
    }),
  ).toBeEnabled({ timeout: 30_000 })
  const canvas = page.locator('canvas')
  await canvas.focus()
  for (let step = 0; step < 7; step += 1) await canvas.press('=')
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Canvas not laid out')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  const labels = await canvas.evaluate(async (element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Missing canvas')
    const context = element.getContext('2d')
    if (!context) throw new Error('Missing context')
    const original = context.fillText
    const text: string[] = []
    context.fillText = function (...args) {
      text.push(args[0])
      return original.apply(this, args)
    }
    const nextDraw = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    const bounds = element.getBoundingClientRect()
    const move = (deltaX: number, deltaY: number) =>
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          buttons: 1,
          clientX: bounds.x + bounds.width / 2 + deltaX,
          clientY: bounds.y + bounds.height / 2 + deltaY,
        }),
      )
    try {
      // A horizontal nudge redraws the exact 7m30s meridians without changing the zoom.
      move(-8, 0)
      await nextDraw()
      const ordinary = [...text]
      text.length = 0
      const worldWidth = bounds.width * 2.3 * 1.5 ** 7
      move(-8, ((91 - 12) / 360) * worldWidth)
      await nextDraw()
      return { ordinary, polar: [...text] }
    } finally {
      context.fillText = original
    }
  })
  await page.mouse.up()
  expect(labels.ordinary).toContain('06h07m30s')
  expect(labels.ordinary).not.toContain('06h08')
  expect(labels.polar).not.toContain('18h07m30s')
  expect(labels.polar).toContain('06h07m30s')
  await expect(page.locator('.map-coordinates')).not.toContainText('+90°')
})

test('search by catalogue identifier, inspect a real star, and select it on the map', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const search = page.getByRole('combobox', {
    name: 'Rechercher une étoile ou une constellation',
    exact: true,
  })
  await expect(search).toBeEnabled({ timeout: 30_000 })
  await search.fill('HIP 32349')
  await expect(page.getByRole('option', { name: /Sirius/ })).toBeVisible()
  await search.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Sirius', exact: true })).toBeVisible()
  await expect(dialog).toContainText('8,6')
  await expect(dialog).toContainText('HD 48915')
  await expect(dialog).toContainText('Non fourni par HYG')
  await dialog.getByRole('button', { name: 'Voir sur la carte' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.map-coordinates')).toContainText('06h 45m')
  const canvas = page.locator('canvas')
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Canvas not laid out')
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } })
  await expect(page.getByRole('heading', { name: 'Sirius', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('drag in both axes, zoom with the wheel or keyboard, reset and toggle layers', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('combobox', { name: 'Rechercher une étoile ou une constellation', exact: true }),
  ).toBeEnabled({ timeout: 30_000 })
  await expect.poll(() => visibleStarCount(page)).toBeGreaterThan(0)
  const coordinates = page.locator('.map-coordinates')
  const initial = (await coordinates.textContent()) ?? ''
  const initialCount = await visibleStarCount(page)
  const canvas = page.locator('canvas')
  await canvas.focus()
  await canvas.press('ArrowRight')
  await expect(coordinates).not.toHaveText(initial)
  const afterHorizontal = (await coordinates.textContent()) ?? ''
  await canvas.press('ArrowUp')
  await expect(coordinates).not.toHaveText(afterHorizontal)
  const beforeZoom = await visibleStarCount(page)
  await canvas.press('=')
  await expect.poll(() => visibleStarCount(page)).toBeLessThan(beforeZoom)
  await canvas.press('-')
  await expect.poll(() => visibleStarCount(page)).toBe(beforeZoom)
  await canvas.press('Home')
  await expect.poll(() => visibleStarCount(page)).toBe(initialCount)
  await expect(coordinates).toHaveText(initial)
  await canvas.hover()
  await page.mouse.wheel(160, 0)
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await expect.poll(() => visibleStarCount(page)).toBe(initialCount)
  await expect(coordinates).toHaveText(initial)
  await page.mouse.wheel(0, -100)
  await expect.poll(() => visibleStarCount(page)).toBeLessThan(initialCount)
  await expect(coordinates).toHaveText(initial)
  await page.mouse.wheel(160, 100)
  await expect.poll(() => visibleStarCount(page)).toBe(initialCount)
  await expect(coordinates).toHaveText(initial)
  const displaySettings = page.getByRole('button', { name: 'Réglages d’affichage', exact: true })
  const displayPanel = page.getByRole('region', { name: 'Affichage', exact: true })
  await expect(displaySettings).toHaveAttribute('aria-expanded', 'false')
  await expect(displayPanel).not.toBeVisible()
  await displaySettings.focus()
  await displaySettings.press('Enter')
  await expect(displaySettings).toHaveAttribute('aria-expanded', 'true')
  await expect(displayPanel).toBeVisible()
  await page.getByRole('checkbox', { name: 'Afficher les constellations' }).uncheck()
  await expect(
    page.getByRole('checkbox', { name: 'Afficher les constellations' }),
  ).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(displayPanel).not.toBeVisible()
  await expect(displaySettings).toHaveAttribute('aria-expanded', 'false')
  await expect(displaySettings).toBeFocused()
  await expect(page.locator('.visible-count')).toHaveCount(0)
  const beforeDrag = (await coordinates.textContent()) ?? ''
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Canvas not laid out')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 + 40, {
    steps: 5,
  })
  await page.mouse.up()
  await expect(coordinates).not.toHaveText(beforeDrag)
  const beforeWheelZoom = await visibleStarCount(page)
  await page.mouse.wheel(0, -80)
  await expect.poll(() => visibleStarCount(page)).toBeLessThan(beforeWheelZoom)

  await canvas.press('Home')
  await expect(coordinates).toHaveText(initial)
  // An off-centre star must remain under the cursor while zooming in and out.
  const sirius = {
    x: bounds.width / 2 - ((6.752481 - 6) / 24) * bounds.width * 2.3,
    y: bounds.height / 2 + ((12 + 16.716116) / 360) * bounds.width * 2.3,
  }
  await canvas.hover({ position: sirius })
  await page.mouse.wheel(0, -400)
  await expect.poll(() => visibleStarCount(page)).toBeLessThan(initialCount)
  const anchoredZoomCount = await visibleStarCount(page)
  await page.mouse.wheel(0, 150)
  await expect.poll(() => visibleStarCount(page)).toBeGreaterThan(anchoredZoomCount)
  await canvas.click({ position: sirius })
  await expect(page.getByRole('heading', { name: 'Sirius', exact: true })).toBeVisible()
})

test('search has empty state and supports accented names and HD identifiers', async ({ page }) => {
  await page.goto('/')
  const search = page.getByRole('combobox', {
    name: 'Rechercher une étoile ou une constellation',
    exact: true,
  })
  await expect(search).toBeEnabled({ timeout: 30_000 })
  await search.fill('inexistante-xyz')
  await expect(page.getByText('Aucun résultat.')).toBeVisible()
  await search.fill('Bételgeuse')
  await expect(page.getByRole('option', { name: /Betelgeuse/ })).toBeVisible()
  await search.press('Escape')
  await expect(page.getByRole('listbox')).not.toBeVisible()
  await search.fill('HD 48915')
  await page.getByRole('option', { name: /Sirius/ }).click()
  await expect(page.getByRole('heading', { name: 'Sirius', exact: true })).toBeVisible()
})

test('constellation search accepts French, Latin and codes and frames the map without a dialog', async ({
  page,
}) => {
  await page.goto('/')
  const search = page.getByRole('combobox', {
    name: 'Rechercher une étoile ou une constellation',
    exact: true,
  })
  await expect(search).toBeEnabled({ timeout: 30_000 })
  const coordinates = page.locator('.map-coordinates')
  const initial = (await coordinates.textContent()) ?? ''
  const displaySettings = page.getByRole('button', { name: 'Réglages d’affichage', exact: true })
  await displaySettings.click()
  await page.getByRole('checkbox', { name: 'Afficher les constellations' }).uncheck()
  await displaySettings.click()
  for (const query of ['Grande Ourse', 'Ursa Major', 'UMa']) {
    await search.fill(query)
    const result = page.getByRole('option', { name: /Grande Ourse.*Constellation.*Ursa Major/ })
    await expect(result).toBeVisible()
    await expect(page.getByRole('option').first()).toHaveText((await result.textContent()) ?? '')
  }
  await search.press('Enter')
  await expect(page.getByRole('listbox')).not.toBeVisible()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.locator('canvas')).toBeFocused()
  await displaySettings.click()
  await expect(page.getByRole('checkbox', { name: 'Afficher les constellations' })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(coordinates).not.toHaveText(initial)
  await expect.poll(() => visibleStarCount(page)).toBeGreaterThan(0)

  const ursaView = (await coordinates.textContent()) ?? ''
  await search.fill('Pégase')
  await page.getByRole('option', { name: /Pégase.*Constellation.*Pegasus/ }).click()
  await expect(coordinates).not.toHaveText(ursaView)
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect.poll(() => visibleStarCount(page)).toBeGreaterThan(0)
})

test('mobile constellation search closes the panel and keeps the map usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Rechercher et régler la carte' }).click()
  const search = page.getByRole('combobox', {
    name: 'Rechercher une étoile ou une constellation',
    exact: true,
  })
  await expect(search).toBeEnabled({ timeout: 30_000 })
  await search.fill('Orion')
  await page.getByRole('option', { name: /Orion.*Constellation/ }).click()
  await expect(page.getByRole('button', { name: 'Fermer les réglages' })).not.toBeVisible()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect.poll(() => visibleStarCount(page)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  const displaySettings = page.getByRole('button', { name: 'Réglages d’affichage', exact: true })
  const displayPanel = page.getByRole('region', { name: 'Affichage', exact: true })
  await displaySettings.click()
  await expect(displayPanel).toBeVisible()
  await expect(displaySettings).toHaveAttribute('aria-expanded', 'true')
  await displayPanel.getByRole('checkbox', { name: 'Afficher la grille équatoriale' }).uncheck()
  await expect(displayPanel).toBeVisible()
  const panelBounds = await displayPanel.boundingBox()
  if (!panelBounds) throw new Error('Display panel not laid out')
  expect(panelBounds.x).toBeGreaterThanOrEqual(0)
  expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(390)
  await displaySettings.click()
  await expect(displayPanel).not.toBeVisible()
  await expect(displaySettings).toHaveAttribute('aria-expanded', 'false')
  await displaySettings.click()
  await expect(
    displayPanel.getByRole('checkbox', { name: 'Afficher la grille équatoriale' }),
  ).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(displayPanel).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Fermer les réglages' })).not.toBeVisible()
})

test('mobile search and detail dialog remain usable without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Rechercher et régler la carte' }).click()
  const search = page.getByRole('combobox', {
    name: 'Rechercher une étoile ou une constellation',
    exact: true,
  })
  await expect(search).toBeEnabled({ timeout: 30_000 })
  await search.fill('Véga')
  await page.getByRole('option', { name: /Vega/ }).click()
  await expect(page.getByRole('heading', { name: 'Vega', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Voir sur la carte' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await expect.poll(() => visibleStarCount(page)).toBeGreaterThan(0)
  const beforeZoom = await visibleStarCount(page)
  await page.locator('canvas').press('=')
  await expect.poll(() => visibleStarCount(page)).toBeLessThan(beforeZoom)
})

test('two-finger touch gesture zooms the map without opening a star', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const mobileSearch = page.getByRole('button', {
    name: 'Rechercher et régler la carte',
  })
  await mobileSearch.click()
  await expect(
    page.getByRole('combobox', { name: 'Rechercher une étoile ou une constellation', exact: true }),
  ).toBeEnabled({ timeout: 30_000 })
  await mobileSearch.click()
  await expect.poll(() => visibleStarCount(page)).toBeGreaterThan(0)
  const beforeZoom = await visibleStarCount(page)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 150, y: 390, id: 1 },
      { x: 230, y: 390, id: 2 },
    ],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 100, y: 390, id: 1 },
      { x: 280, y: 390, id: 2 },
    ],
  })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => visibleStarCount(page)).toBeLessThan(beforeZoom)
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await session.detach()
})

test('catalogue load failure offers a working retry', async ({ page }) => {
  await page.route('**/data/stars.json*', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  )
  await page.goto('/')
  const retry = page.getByRole('button', { name: 'Réessayer', exact: true })
  await expect(retry).toBeVisible()
  await expect(
    page.getByRole('combobox', { name: 'Rechercher une étoile ou une constellation', exact: true }),
  ).toBeDisabled()
  await page.unroute('**/data/stars.json*')
  await retry.click()
  await expect(
    page.getByRole('combobox', { name: 'Rechercher une étoile ou une constellation', exact: true }),
  ).toBeEnabled({ timeout: 30_000 })
})
