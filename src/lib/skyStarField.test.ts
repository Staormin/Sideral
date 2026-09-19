import { afterEach, describe, expect, it, vi } from 'vitest'
import { starRadius } from './astronomy'
import {
  getRasterLayout,
  MAX_RASTER_PIXELS,
  starAppearanceScale,
  StarFieldCache,
} from './skyStarField'
import type { SkyView } from './skyProjection'

const view: SkyView = { ra: 6, dec: 12, width: 1200, height: 700, zoom: 1 }

afterEach(() => vi.unstubAllGlobals())

interface RasterCopy {
  x: number
  y: number
  width: number
  height: number
}

function createCache(cachedView: SkyView) {
  const copies: RasterCopy[] = []
  let transform = { x: 0, y: 0, scaleX: 1, scaleY: 1 }
  const stack: (typeof transform)[] = []
  const drawImage = vi.fn(
    (_image: CanvasImageSource, x: number, y: number, width: number, height: number) => {
      copies.push({
        x: transform.x + x * transform.scaleX,
        y: transform.y + y * transform.scaleY,
        width: width * transform.scaleX,
        height: height * transform.scaleY,
      })
    },
  )
  const context = {
    drawImage,
    save: vi.fn(() => stack.push({ ...transform })),
    restore: vi.fn(() => {
      transform = stack.pop() ?? transform
    }),
    translate: vi.fn((x: number, y: number) => {
      transform.x += x * transform.scaleX
      transform.y += y * transform.scaleY
    }),
    scale: vi.fn((x: number, y: number) => {
      transform.scaleX *= x
      transform.scaleY *= y
    }),
  } as unknown as CanvasRenderingContext2D
  const canvas = { width: 0, height: 0, getContext: () => ({ setTransform: vi.fn() }) }
  const createElement = vi.fn(() => canvas)
  vi.stubGlobal('document', { createElement })
  const cache = new StarFieldCache()
  cache.rebuild([], cachedView, 1)
  return { cache, context, drawImage, createElement, copies }
}

describe('star raster layout', () => {
  it('covers the complete celestial sphere and leaves room for polar halos', () => {
    const layout = getRasterLayout(view, 1)
    const largestHalo = starRadius(-30, view.zoom) * 8
    expect(layout.worldWidth).toBe(1200)
    expect(layout.gutter).toBeGreaterThan(largestHalo)
    expect(layout.height).toBe(layout.worldWidth / 2 + 2 * layout.gutter)
    expect(layout.pixelWidth).toBe(layout.worldWidth)
    expect(layout.pixelHeight).toBe(layout.height)
  })

  it('honors high DPI until the bounded bitmap budget is reached', () => {
    const standard = getRasterLayout(view, 1)
    const retina = getRasterLayout(view, 2)
    expect(retina.pixelWidth).toBe(standard.pixelWidth * 2)
    expect(retina.pixelHeight).toBe(standard.pixelHeight * 2)

    const large = getRasterLayout({ ...view, width: 7680, zoom: 4 }, 3)
    expect(large.pixelWidth * large.pixelHeight).toBeLessThanOrEqual(MAX_RASTER_PIXELS)
    expect(large.pixelWidth).toBeLessThan(7680 * 4 * 3)
    expect(large.pixelWidth / large.pixelHeight).toBeCloseTo(large.worldWidth / large.height, 2)
  })

  it('does not change when panning or when only viewport height changes', () => {
    const original = getRasterLayout(view, 2)
    expect(getRasterLayout({ ...view, ra: 23.9, dec: -65, height: 1200 }, 2)).toEqual(original)
  })

  it('preserves the original zoom-dependent stellar radii', () => {
    for (const zoom of [1, 2.3, 4.5, 12, 96]) {
      const scale = starAppearanceScale(zoom)
      for (const magnitude of [-1.46, 0, 2.6, 5, 9, 15]) {
        expect(starRadius(magnitude, 1) * scale.radius).toBeCloseTo(starRadius(magnitude, zoom))
      }
      expect(scale.minAlpha).toBeGreaterThan(0)
    }
  })
})

describe('star raster boundaries', () => {
  it('draws one upright vertical strip even in a tall viewport', () => {
    const portraitView = { ...view, width: 320, height: 1400, dec: 87 }
    const { cache, context, copies } = createCache(portraitView)
    cache.draw(context, portraitView)
    expect(copies.length).toBeGreaterThan(0)
    expect(new Set(copies.map((copy) => copy.y)).size).toBe(1)
    expect(copies.every((copy) => copy.height > 0)).toBe(true)
  })

  it('does not bring the raster back after a vertical turn', () => {
    const { cache, context, copies, createElement } = createCache(view)
    for (const turns of [-3, -1, 1, 4]) {
      copies.length = 0
      cache.draw(context, { ...view, dec: view.dec + turns * 360 })
      expect(copies).toEqual([])
    }
    expect(createElement).toHaveBeenCalledTimes(1)
  })

  it('scales one upright raster while zooming', () => {
    const { cache, context, copies } = createCache(view)
    cache.draw(context, { ...view, zoom: 1.5, height: 1400 })
    expect(new Set(copies.map((copy) => copy.y)).size).toBe(1)
    for (const copy of copies) {
      expect(copy.width).toBe(view.width * 1.5)
      expect(copy.height).toBe(getRasterLayout(view, 1).height * 1.5)
    }
  })

  it.each([-179, -95, -90, 0, 90, 95, 179])(
    'aligns star images with physical celestial coordinates at chart latitude %s',
    (dec) => {
      const poleView = { ...view, dec, height: 1000 }
      const { cache, context, copies } = createCache(poleView)
      cache.draw(context, poleView)
      const layout = getRasterLayout(poleView, 1)
      const star = { ra: 5.25, dec: dec < 0 ? -82 : 82 }
      const atlasX = layout.worldWidth * (1 - star.ra / 24)
      const atlasY = ((90 - star.dec) * layout.worldWidth) / 360 + layout.gutter
      const actual = copies
        .map(({ x, y, width, height }) => ({
          x: x + (atlasX / layout.worldWidth) * width,
          y: y + (atlasY / layout.height) * height,
        }))
        .filter(({ x, y }) => x >= 0 && x < poleView.width && y >= 0 && y < poleView.height)
        .sort((a, b) => a.y - b.y)
      const expected: { x: number; y: number }[] = []
      for (let wrap = -2; wrap <= 2; wrap += 1) {
        const x =
          poleView.width / 2 - ((star.ra - poleView.ra + wrap * 24) / 24) * layout.worldWidth
        const y = poleView.height / 2 + ((poleView.dec - star.dec) / 360) * layout.worldWidth
        if (x >= 0 && x < poleView.width && y >= 0 && y < poleView.height) expected.push({ x, y })
      }
      expected.sort((a, b) => a.y - b.y)
      expect(actual).toHaveLength(expected.length)
      expect(actual.length).toBeGreaterThan(0)
      actual.forEach((point, index) => {
        expect(point.x).toBeCloseTo(expected[index]!.x)
        expect(point.y).toBeCloseTo(expected[index]!.y)
      })
      // Restoring the transform also keeps following labels and selection markers upright.
      expect(context.save).toHaveBeenCalledTimes(vi.mocked(context.restore).mock.calls.length)
    },
  )
})
