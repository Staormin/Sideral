import { describe, expect, it } from 'vitest'
import {
  constrainSkyView,
  latitudeDifference,
  normalizeSkyPosition,
  forEachProjectedPosition,
  projectChartPosition,
  unprojectChartPoint,
  fitSkyPositions,
  forEachVisibleCopy,
  MAX_ZOOM,
  MIN_ZOOM,
  projectPosition,
  raDifference,
  SkyIndex,
  unprojectPoint,
  wrapLatitude,
  wrapRa,
  type ScreenPoint,
  type SkyPosition,
  type SkyView,
} from './skyProjection'

const view: SkyView = { ra: 0, dec: 0, width: 1200, height: 700, zoom: 4 }

describe('equatorial projection', () => {
  it('places increasing right ascension to the left and north above', () => {
    expect(projectPosition({ ra: 1, dec: 15 }, view)).toEqual({ x: 400, y: 150 })
  })

  it('crosses the 24h meridian without a discontinuity', () => {
    expect(wrapRa(-1)).toBe(23)
    expect(raDifference(23.5, 0)).toBe(-0.5)
    expect(projectPosition({ ra: 23.5, dec: 0 }, view).x).toBe(700)
  })

  it('round-trips celestial coordinates through the viewport', () => {
    const position = { ra: 23.72, dec: -18.4 }
    const restored = unprojectPoint(projectPosition(position, view), view)
    expect(restored.ra).toBeCloseTo(position.ra)
    expect(restored.dec).toBeCloseTo(position.dec)
  })

  it('keeps positions beyond the north pole outside the physical chart', () => {
    const polarView = { ...view, dec: 89 }
    const twoDegrees = (2 / 360) * view.width * view.zoom
    const point = { x: view.width / 2, y: view.height / 2 - twoDegrees }
    expect(unprojectChartPoint(point, polarView)).toEqual({ ra: 0, dec: 91 })
    expect(unprojectPoint(point, polarView)).toEqual({ ra: 0, dec: 91 })
    expect(normalizeSkyPosition({ ra: 2, dec: -91 })).toEqual({ ra: 14, dec: -89 })
  })

  it('does not identify the opposite celestial poles or their neighboring stars', () => {
    expect(normalizeSkyPosition({ ra: 0, dec: 90 }).dec).toBe(90)
    expect(normalizeSkyPosition({ ra: 0, dec: -90 }).dec).toBe(-90)
    const polarView = { ...view, dec: 89 }
    const copies: ScreenPoint[] = []
    forEachProjectedPosition({ ra: 0, dec: -89 }, polarView, (point) => copies.push(point))
    expect(copies).toEqual([])
    expect(projectPosition({ ra: 0, dec: 90 }, polarView)).not.toEqual(
      projectPosition({ ra: 0, dec: -90 }, polarView),
    )
  })

  it('uses a full 360-degree meridian cycle for chart latitude', () => {
    expect(wrapLatitude(181)).toBe(-179)
    expect(wrapLatitude(-181)).toBe(179)
    expect(wrapLatitude(360)).toBe(0)
    expect(latitudeDifference(-179, 179)).toBe(-358)
    expect(normalizeSkyPosition({ ra: 0, dec: 180 })).toEqual({ ra: 12, dec: 0 })
    expect(normalizeSkyPosition({ ra: 0, dec: 360 })).toEqual({ ra: 0, dec: 0 })
    const point = { x: 600, y: 350 - view.width * view.zoom }
    expect(unprojectPoint(point, view)).toEqual({ ra: 0, dec: 360 })
  })

  function unitVector(position: SkyPosition): number[] {
    const alpha = (position.ra * Math.PI) / 12
    const delta = (position.dec * Math.PI) / 180
    return [Math.cos(delta) * Math.cos(alpha), Math.cos(delta) * Math.sin(alpha), Math.sin(delta)]
  }

  it('preserves the actual unit vector when canonicalizing either pole and repeated meridian turns', () => {
    for (const ra of [-35, 0, 5.4, 24, 49]) {
      for (const dec of [-1081, -449, -180, -91, -90, -89, 0, 89, 90, 91, 180, 449, 1081]) {
        const position = { ra, dec }
        const normalized = normalizeSkyPosition(position)
        expect(normalized.ra).toBeGreaterThanOrEqual(0)
        expect(normalized.ra).toBeLessThan(24)
        expect(normalized.dec).toBeGreaterThanOrEqual(-90)
        expect(normalized.dec).toBeLessThanOrEqual(90)
        const expected = unitVector(position)
        unitVector(normalized).forEach((component, index) => {
          expect(component).toBeCloseTo(expected[index] ?? 0, 12)
        })
      }
    }
  })

  it('does not move a distant star into the viewport through a reflected image', () => {
    const position = { ra: 13, dec: 84 }
    const polarView = { ...view, ra: 1, dec: 90 }
    const copies: ScreenPoint[] = []
    forEachProjectedPosition(position, polarView, (point) => copies.push(point))
    expect(copies).toEqual([])
    expect(unprojectPoint(projectPosition(position, polarView), polarView)).toEqual(position)
  })

  it('repeats horizontally but keeps vertical distances unwrapped', () => {
    const position = { ra: 23.75, dec: -83 }
    const original = projectChartPosition(position, { ...view, dec: 85 })
    for (const turns of [-12, -1, 0, 1, 12]) {
      const projected = projectChartPosition(position, {
        ...view,
        ra: turns * 24,
        dec: 85 + turns * 360,
      })
      expect(projected.x).toBe(original.x)
      expect(projected.y).toBeCloseTo(original.y + turns * view.width * view.zoom)
    }
  })
})

describe('viewport boundaries', () => {
  it.each([
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ])('keeps both viewport edges inside the chart at every zoom for %j', (dimensions) => {
    for (const zoom of [0.1, 1, 2.3, 8, 96]) {
      for (const dec of [-10000, -90, 0, 90, 10000]) {
        const constrained = { ...dimensions, ra: 6, dec, zoom }
        constrainSkyView(constrained)
        const top = unprojectPoint({ x: 0, y: 0 }, constrained).dec
        const bottom = unprojectPoint({ x: 0, y: dimensions.height }, constrained).dec
        expect(top).toBeLessThanOrEqual(90 + 1e-9)
        expect(bottom).toBeGreaterThanOrEqual(-90 - 1e-9)
      }
    }
  })
})

describe('fitting celestial figures', () => {
  const figure: SkyPosition[] = [
    { ra: 23.5, dec: 8 },
    { ra: 0.25, dec: 32 },
    { ra: 1.5, dec: -12 },
    { ra: 0.75, dec: 5 },
  ]

  it('centers a figure across the 24h seam on its shortest RA arc', () => {
    const fitted = fitSkyPositions(figure, view)
    expect(fitted?.ra).toBeCloseTo(0.5)
    expect(fitted?.dec).toBe(10)
    expect(fitted?.zoom).toBeCloseTo((604 * 360) / (1200 * 44))
  })

  it.each([
    { ...view, width: 1440, height: 900 },
    { ...view, width: 320, height: 900 },
    { ...view, width: 900, height: 320 },
  ])('keeps all figure anchors inside the padded viewport %j', (viewport) => {
    const fitted = fitSkyPositions(figure, viewport)
    expect(fitted).not.toBeNull()
    const fittedView = { ...viewport, ...fitted }
    for (const position of figure) {
      const point = projectPosition(position, fittedView)
      expect(point.x).toBeGreaterThanOrEqual(48 - 1e-9)
      expect(point.x).toBeLessThanOrEqual(viewport.width - 48 + 1e-9)
      expect(point.y).toBeGreaterThanOrEqual(48 - 1e-9)
      expect(point.y).toBeLessThanOrEqual(viewport.height - 48 + 1e-9)
    }
  })

  it('fits a wide figure on a narrow portrait screen without choosing the long RA arc', () => {
    const viewport = { ...view, width: 320, height: 900 }
    const positions = [
      { ra: 20, dec: -20 },
      { ra: 23.25, dec: 40 },
      { ra: 4, dec: 15 },
    ]
    const fitted = fitSkyPositions(positions, viewport)
    expect(fitted?.ra).toBe(0)
    expect(fitted?.zoom).toBeCloseTo(2.1)
    for (const position of positions) {
      const point = projectPosition(position, { ...viewport, ...fitted })
      expect(point.x).toBeGreaterThanOrEqual(48 - 1e-9)
      expect(point.x).toBeLessThanOrEqual(272 + 1e-9)
    }
  })

  it('uses the actual declination extent instead of fitting a short arc across the poles', () => {
    const fitted = fitSkyPositions(
      [
        { ra: 5, dec: -85 },
        { ra: 5, dec: 85 },
      ],
      view,
    )
    expect(fitted?.dec).toBe(0)
    expect(fitted?.zoom).toBeCloseTo((604 * 360) / (1200 * 170))
  })

  it('caps zoom for coincident anchors and treats a flat axis as unconstrained', () => {
    expect(fitSkyPositions([{ ra: 25, dec: 15 }], view)).toEqual({
      ra: 1,
      dec: 15,
      zoom: MAX_ZOOM,
    })
    expect(
      fitSkyPositions(
        [
          { ra: 4, dec: 15 },
          { ra: 6, dec: 15 },
        ],
        view,
      )?.zoom,
    ).toBeCloseTo((1104 * 24) / (1200 * 2))
  })

  it('returns a finite bounded view when padding exceeds a tiny viewport', () => {
    const fitted = fitSkyPositions(figure, { ...view, width: 0, height: 0 }, 500)
    expect(fitted).not.toBeNull()
    expect(Number.isFinite(fitted?.zoom)).toBe(true)
    expect(fitted?.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
    expect(fitted?.zoom).toBeLessThanOrEqual(MAX_ZOOM)
  })

  it('honors the minimum zoom when a broad figure cannot fit with the requested padding', () => {
    const fitted = fitSkyPositions(
      [
        { ra: 0, dec: -89 },
        { ra: 6, dec: 89 },
        { ra: 12, dec: 0 },
        { ra: 18, dec: 0 },
      ],
      { ...view, width: 1400, height: 200 },
    )
    expect(fitted?.zoom).toBe(MIN_ZOOM)
  })

  it('returns null when a figure has no anchors', () => {
    expect(fitSkyPositions([], view)).toBeNull()
  })
})

describe('visible repeated images', () => {
  it('shows a polar star only once, below the north boundary', () => {
    const viewport = { ...view, ra: 2, dec: 90, width: 1200, height: 1200, zoom: 1 }
    const copies: ScreenPoint[] = []
    forEachProjectedPosition({ ra: 2, dec: 80 }, viewport, (point) => copies.push(point))
    expect(copies).toHaveLength(1)
    expect(copies[0]?.x).toBe(600)
    expect(copies[0]?.y).toBeCloseTo(600 + 100 / 3)
  })

  it('does not duplicate the arbitrarily chosen meridian of an exact pole', () => {
    const viewport = { ...view, width: 1200, height: 1200, zoom: 1 }
    const copies: ScreenPoint[] = []
    forEachProjectedPosition({ ra: 0, dec: 90 }, viewport, (point) => copies.push(point))
    expect(copies).toEqual([{ x: 600, y: 300 }])
  })

  it('does not repeat stars vertically in tall viewports', () => {
    const viewport = { ...view, width: 320, height: 900, zoom: 1 }
    const copies: ScreenPoint[] = []
    forEachVisibleCopy({ x: 160, y: 450 }, viewport, (point) => copies.push(point))
    expect(copies).toEqual([{ x: 160, y: 450 }])
  })

  it('includes copies touching either seam and respects glyph padding', () => {
    const viewport = { ...view, width: 1200, height: 1200, zoom: 1 }
    const copies: ScreenPoint[] = []
    forEachVisibleCopy({ x: 1204, y: 1202 }, viewport, (point) => copies.push(point), 5)
    expect(copies).toEqual([
      { x: 4, y: 1202 },
      { x: 1204, y: 1202 },
    ])
  })

  it('does not visit invisible copies at a close zoom', () => {
    const copies: ScreenPoint[] = []
    forEachVisibleCopy({ x: 600, y: -30 }, view, (point) => copies.push(point), 10)
    expect(copies).toEqual([])
  })
})

describe('star spatial index', () => {
  const stars = [
    { ra: 23.9, dec: 0, id: 1 },
    { ra: 0.1, dec: 0, id: 2 },
    { ra: 12, dec: 0, id: 3 },
    { ra: 0, dec: 89, id: 4 },
    { ra: 0, dec: -89, id: 5 },
    { ra: 12, dec: 89, id: 6 },
  ]
  const index = new SkyIndex(stars)

  it('queries both sides of the RA seam and excludes distant cells', () => {
    expect(
      index
        .query(view)
        .map((star) => star.id)
        .sort(),
    ).toEqual([1, 2])
  })

  it('returns every catalogue star once at a full-sky view', () => {
    const results = index.query({ ...view, zoom: 1, height: 650 }, 30)
    expect(results).toHaveLength(stars.length)
    expect(new Set(results).size).toBe(stars.length)
  })

  it('includes the celestial poles', () => {
    expect(
      index
        .query({ ...view, dec: 90 })
        .map((star) => star.id)
        .sort(),
    ).toEqual([4])
  })

  it('counts each catalogue entry once in a tall portrait view', () => {
    const portrait = { ...view, width: 320, height: 1200, zoom: 1, dec: 82 }
    expect(index.query(portrait)).toHaveLength(stars.length)
    expect(index.countInView(portrait)).toBe(stars.length)
  })

  it('iterates the same candidate objects as query without duplicates near a full turn', () => {
    const almostFullSky = { ...view, ra: 0.08, zoom: 1.001, height: 900 }
    const visited: (typeof stars)[number][] = []
    index.forEachInView(almostFullSky, (star) => visited.push(star), 30)
    expect(visited).toEqual(index.query(almostFullSky, 30))
    expect(new Set(visited).size).toBe(visited.length)
  })

  // Independent oracle: enumerate unfolded angular coordinates without using projection helpers.
  function isVisible(position: SkyPosition, viewport: SkyView, padding = 0): boolean {
    const worldWidth = viewport.width * viewport.zoom
    const edgePadding = padding + 1e-7
    const y = viewport.height / 2 - ((position.dec - viewport.dec) / 360) * worldWidth
    if (y < -edgePadding || y > viewport.height + edgePadding) return false
    for (let turn = -4; turn <= 4; turn += 1) {
      const x = viewport.width / 2 - ((position.ra + turn * 24 - viewport.ra) / 24) * worldWidth
      if (x >= -edgePadding && x <= viewport.width + edgePadding) return true
    }
    return false
  }

  const testViews: SkyView[] = [
    { ...view, ra: 6, zoom: 1, height: 900 },
    { ...view, ra: 23.95, zoom: 1, height: 300 },
    { ...view, ra: 0.08, zoom: 1.001, height: 900 },
    { ...view, ra: 23.99, zoom: 8, dec: 12 },
    { ...view, ra: 0.01, zoom: 8, dec: -12 },
    { ...view, ra: 12, zoom: 96, dec: 40 },
    { ...view, ra: 18, zoom: 1, width: 320, height: 900 },
    { ...view, ra: 23.75, zoom: 1, width: 1800, height: 320 },
    { ...view, ra: 0, zoom: 96, dec: 89 },
    { ...view, ra: 24, zoom: 96, dec: -89 },
    { ...view, ra: 0, zoom: 1, height: 600 },
    { ...view, ra: 0, dec: 60, zoom: 1, height: 200 },
    { ...view, ra: 0, dec: 91.875, zoom: 96, height: 1200 },
    { ...view, ra: 0, dec: -91.875, zoom: 96, height: 1200 },
    { ...view, ra: 48, dec: 449, zoom: 8, height: 1200 },
    { ...view, ra: -48, dec: -449, zoom: 8, height: 1200 },
    { ...view, ra: 0.2, dec: 89.5, zoom: 2, height: 1190 },
    { ...view, ra: 0.2, dec: -89.5, zoom: 2, height: 1190 },
    { ...view, ra: 14.4, dec: 81, width: 320, height: 1200, zoom: 1 },
    { ...view, ra: 3, dec: 179, zoom: 4 },
    { ...view, ra: 23, dec: -179, zoom: 4 },
    { ...view, ra: 0, dec: 720, zoom: 1 },
    { ...view, ra: 24, dec: -720, zoom: 1 },
  ]

  // Include exact cell boundaries, poles, meridians and every viewport's pixel edges.
  const samplePositions: SkyPosition[] = []
  for (let ra = 0; ra <= 24; ra += 0.25) {
    for (let dec = -90; dec <= 90; dec += 5) samplePositions.push({ ra, dec })
  }
  for (const viewport of testViews) {
    for (const x of [0, viewport.width / 2, viewport.width]) {
      for (const y of [0, viewport.height / 2, viewport.height]) {
        const position = unprojectPoint({ x, y }, viewport)
        if (Math.abs(position.dec) <= 90) samplePositions.push(position)
      }
    }
  }
  let seed = 1847
  function random(): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (let i = 0; i < 5000; i += 1) {
    samplePositions.push({ ra: random() * 24, dec: random() * 180 - 90 })
  }
  for (let i = 0; i < 40; i += 1) {
    testViews.push({
      ra: random() * 24,
      dec: random() * 360 - 180,
      zoom: 1 + random() * 95,
      width: 320 + random() * 1400,
      height: 300 + random() * 800,
    })
  }
  const sampleIndex = new SkyIndex(samplePositions)

  it.each(testViews)('counts exactly the projected centers for view %j', (viewport) => {
    const expected = samplePositions.filter((position) => isVisible(position, viewport))
    expect(sampleIndex.countInView(viewport)).toBe(expected.length)
  })

  it.each(testViews)(
    'visits all visible stars once, including padding, for view %j',
    (viewport) => {
      const padding = 24
      const visited = new Set<SkyPosition>()
      sampleIndex.forEachInView(
        viewport,
        (position) => {
          expect(visited.has(position)).toBe(false)
          visited.add(position)
        },
        padding,
      )
      const expected = samplePositions.filter((position) => isVisible(position, viewport, padding))
      expect(
        [...visited].filter((position) => isVisible(position, viewport, padding)),
      ).toHaveLength(expected.length)
    },
  )

  it('counts a full-sky view from cell populations without reading individual stars', () => {
    let coordinateReads = 0
    const countedIndex = new SkyIndex(
      samplePositions.map((position) => ({
        get ra() {
          coordinateReads += 1
          return position.ra
        },
        get dec() {
          coordinateReads += 1
          return position.dec
        },
      })),
    )
    coordinateReads = 0
    expect(countedIndex.countInView({ ...view, zoom: 1, height: 900 })).toBe(samplePositions.length)
    expect(coordinateReads).toBe(0)
  })
})
