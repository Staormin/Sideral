import { describe, expect, it } from 'vitest'
import { greatCirclePath } from './skyGeometry'
import { projectSkyPaths, traceSkyPaths } from './skyPaths'
import type { SkyPosition, SkyView } from './skyProjection'

type Segment = readonly [number, number, number, number]

const defaultView: SkyView = { ra: 0, dec: 0, width: 240, height: 120, zoom: 2 }

function trace(paths: readonly (readonly SkyPosition[])[], view = defaultView): Segment[] {
  const segments: Segment[] = []
  let start: readonly [number, number] | undefined
  const ctx = Object.freeze({
    moveTo(x: number, y: number) {
      expect(start).toBeUndefined()
      start = [x, y]
    },
    lineTo(x: number, y: number) {
      expect(start).toBeDefined()
      segments.push([start![0], start![1], x, y])
      start = undefined
    },
  }) as unknown as CanvasRenderingContext2D
  traceSkyPaths(ctx, paths, view)
  expect(start).toBeUndefined()
  return segments
}

function svgSegments(paths: readonly string[]): Segment[] {
  return paths.flatMap((path) => {
    const commands = path.split(' ')
    const segments: Segment[] = []
    let previous: readonly [number, number] | undefined
    for (let index = 0; index < commands.length; index += 3) {
      const next = [Number(commands[index + 1]), Number(commands[index + 2])] as const
      if (commands[index] === 'L' && previous) segments.push([...previous, ...next])
      else expect(commands[index]).toBe('M')
      previous = next
    }
    return segments
  })
}

function expectSameGeometry(paths: readonly (readonly SkyPosition[])[], view: SkyView): void {
  const canonical = (segments: Segment[]) =>
    segments.map((segment) => segment.map((coordinate) => coordinate.toFixed(7)).join(',')).sort()
  expect(canonical(svgSegments(projectSkyPaths(paths, view)))).toEqual(
    canonical(trace(paths, view)),
  )
}

describe('celestial path drawing', () => {
  it('projects supplied endpoints without changing the drawing context state', () => {
    expect(
      trace([
        [
          { ra: 0, dec: 0 },
          { ra: 1, dec: 15 },
        ],
      ]),
    ).toEqual([[120, 60, 100, 40]])
  })

  it('keeps unwrapped right ascension continuous across zero', () => {
    expect(
      trace([
        [
          { ra: 23.5, dec: 0 },
          { ra: 24.5, dec: 0 },
        ],
      ]),
    ).toEqual([[130, 60, 110, 60]])
  })

  it('retains both short edge fragments when a path crosses a horizontal chart boundary', () => {
    const view = { ...defaultView, ra: 12, zoom: 1 }
    expect(
      trace(
        [
          [
            { ra: 23.5, dec: 0 },
            { ra: 24.5, dec: 0 },
          ],
        ],
        view,
      ),
    ).toEqual([
      [5, 60, -5, 60],
      [245, 60, 235, 60],
    ])
  })

  it('reflects declination and shifts right ascension by twelve hours beyond a pole', () => {
    const view = { ...defaultView, ra: 12, dec: 100 }
    const segments = trace(
      [
        [
          { ra: 0, dec: 80 },
          { ra: 1, dec: 70 },
        ],
      ],
      view,
    )
    expect(segments).toHaveLength(1)
    expect(segments[0]!.slice(0, 3)).toEqual([120, 60, 100])
    expect(segments[0]![3]).toBeCloseTo(60 - 40 / 3)
  })

  it('keeps separated polar runs separate instead of drawing a horizontal pole bridge', () => {
    const paths = [
      [
        { ra: 3, dec: 80 },
        { ra: 3, dec: 90 },
      ],
      [
        { ra: 15, dec: 90 },
        { ra: 15, dec: 80 },
      ],
    ] as const
    const segments = trace(paths, { ...defaultView, ra: 3, dec: 90, zoom: 1 })
    expect(segments).toHaveLength(6)
    for (const [x1, y1, x2, y2] of segments) {
      expect(x1).toBe(x2)
      expect(Math.abs(y2 - y1)).toBeCloseTo(20 / 3)
    }
  })

  it('repeats physical runs through a tall viewport every full meridian turn', () => {
    const view = { ...defaultView, zoom: 1, height: 1000 }
    const segments = trace(
      [
        [
          { ra: 0, dec: 0 },
          { ra: 1, dec: 0 },
        ],
      ],
      view,
    )
    const direct = segments.filter(([x]) => x === 120)
    expect(direct.map(([, y]) => y)).toEqual([20, 260, 500, 740, 980])
    expect(segments.some(([x, y]) => x === 0 && y === 380)).toBe(true)
    expect(segments.every(([, y1, , y2]) => y1 === y2)).toBe(true)
  })

  it('retains a visible segment whose endpoints both fall outside the viewport', () => {
    const segments = trace(
      [
        [
          { ra: -2, dec: 0 },
          { ra: 2, dec: 0 },
        ],
      ],
      {
        ...defaultView,
        zoom: 10,
      },
    )
    expect(segments).toContainEqual([320, 60, -80, 60])
  })

  it('does not trace distant segments or incomplete runs', () => {
    const paths = [
      [],
      [{ ra: 0, dec: 0 }],
      [
        { ra: 8, dec: 30 },
        { ra: 9, dec: 40 },
      ],
    ]
    expect(trace(paths, { ...defaultView, zoom: 10 })).toEqual([])
  })

  it.each([-1, 1])('preserves tessellated great-circle breaks through pole %i', (sign) => {
    const view = { ...defaultView, ra: 3, dec: sign * 90 }
    const paths = greatCirclePath(
      { ra: 3, dec: sign * 80 },
      { ra: 15, dec: sign * 75 },
      view.width * view.zoom,
    )
    const segments = trace(paths, view)
    expect(paths).toHaveLength(2)
    expect(segments.length).toBeGreaterThan(1)
    for (const [x1, y1, x2, y2] of segments) {
      expect(x1).toBeCloseTo(x2, 8)
      expect(Math.abs(y2 - y1)).toBeLessThan(3)
    }
  })
})

describe('continuous SVG celestial paths', () => {
  it('joins consecutive segments without rounding their projected coordinates', () => {
    const paths = [
      [
        { ra: 0, dec: 0 },
        { ra: 1, dec: 15 },
        { ra: 2, dec: 30 },
      ],
    ]
    expect(projectSkyPaths(paths, defaultView)).toEqual(['M 120 60 L 100 40 L 80 20'])
    expectSameGeometry(paths, defaultView)
  })

  it('joins each edge fragment independently while crossing the RA projection seam', () => {
    const paths = [[22.5, 23.5, 24.5, 25.5].map((ra) => ({ ra, dec: 0 }))]
    const view = { ...defaultView, ra: 12, zoom: 1 }
    expect(projectSkyPaths(paths, view)).toEqual([
      'M 15 60 L 5 60 L -5 60',
      'M 245 60 L 235 60 L 225 60',
    ])
    expectSameGeometry(paths, view)
  })

  it('does not join unrelated input runs even when they share a projected endpoint', () => {
    expect(
      projectSkyPaths(
        [
          [
            { ra: 0, dec: 0 },
            { ra: 1, dec: 0 },
          ],
          [
            { ra: 1, dec: 0 },
            { ra: 2, dec: 0 },
          ],
        ],
        defaultView,
      ),
    ).toEqual(['M 120 60 L 100 60', 'M 100 60 L 80 60'])
  })

  it('starts a new visible portion after the path leaves the viewport', () => {
    const paths = [[0, 1, 2, 3, 2, 1, 0].map((ra) => ({ ra, dec: 0 }))]
    const view = { ...defaultView, zoom: 10 }
    expect(projectSkyPaths(paths, view)).toEqual([
      'M 120 60 L 20 60 L -80 60',
      'M -80 60 L 20 60 L 120 60',
    ])
    expectSameGeometry(paths, view)
  })

  it('retains segments crossing the viewport with both endpoints outside', () => {
    const paths = [
      [
        { ra: -2, dec: 0 },
        { ra: 2, dec: 0 },
      ],
    ]
    const view = { ...defaultView, zoom: 10 }
    expect(projectSkyPaths(paths, view)).toContain('M 320 60 L -80 60')
    expectSameGeometry(paths, view)
  })

  it('keeps all repeated chart copies separate in a tall viewport', () => {
    const paths = [[0, 1, 2].map((ra) => ({ ra, dec: 0 }))]
    const view = { ...defaultView, zoom: 1, height: 1000 }
    const projected = projectSkyPaths(paths, view)
    expect(projected.filter((path) => path.startsWith('M 120 '))).toHaveLength(5)
    expect(projected.every((path) => (path.match(/L /g) ?? []).length <= 2)).toBe(true)
    expectSameGeometry(paths, view)
  })

  it.each([-1, 1])('keeps both reflected sides of pole %i separate', (sign) => {
    const view = { ...defaultView, ra: 3, dec: sign * 90 }
    const paths = greatCirclePath(
      { ra: 3, dec: sign * 80 },
      { ra: 15, dec: sign * 75 },
      view.width * view.zoom,
    )
    const projected = projectSkyPaths(paths, view)
    expect(projected.length).toBeGreaterThanOrEqual(2)
    for (const [x1, , x2] of svgSegments(projected)) expect(x1).toBeCloseTo(x2, 8)
    expectSameGeometry(paths, view)
  })

  it('omits invisible and incomplete runs', () => {
    expect(
      projectSkyPaths(
        [
          [],
          [{ ra: 0, dec: 0 }],
          [
            { ra: 8, dec: 30 },
            { ra: 9, dec: 40 },
          ],
        ],
        { ...defaultView, zoom: 10 },
      ),
    ).toEqual([])
  })
})
