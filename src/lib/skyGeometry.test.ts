import { describe, expect, it } from 'vitest'
import { formatRaGrid, greatCirclePath } from './skyGeometry'
import { raDifference, type SkyPosition } from './skyProjection'

type Vector = [number, number, number]

function unit(position: SkyPosition): Vector {
  const longitude = (position.ra * Math.PI) / 12
  const latitude = (position.dec * Math.PI) / 180
  return [
    Math.cos(latitude) * Math.cos(longitude),
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
  ]
}

function dot(a: Vector, b: Vector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vector, b: Vector): Vector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function distance(a: SkyPosition, b: SkyPosition): number {
  const first = unit(a)
  const last = unit(b)
  return Math.atan2(Math.hypot(...cross(first, last)), dot(first, last))
}

function interpolate(start: SkyPosition, end: SkyPosition, fraction: number): SkyPosition {
  const first = unit(start)
  const last = unit(end)
  const angle = distance(start, end)
  const firstWeight = Math.sin((1 - fraction) * angle) / Math.sin(angle)
  const lastWeight = Math.sin(fraction * angle) / Math.sin(angle)
  const [x, y, z] = first.map((value, index) => value * firstWeight + last[index]! * lastWeight)
  return {
    ra: (Math.atan2(y!, x!) * 12) / Math.PI,
    dec: (Math.atan2(z!, Math.hypot(x!, y!)) * 180) / Math.PI,
  }
}

describe('great-circle constellation paths', () => {
  const octans = [
    // Nu Octantis and Delta Octantis, HYG 4.1 / HIP 107089 and 70638.
    { ra: 21.691253, dec: -77.390046 },
    { ra: 14.448801, dec: -83.667884 },
  ] as const
  const examples = [
    [
      { ra: 1, dec: 20 },
      { ra: 8, dec: 45 },
    ],
    [
      { ra: 23, dec: 10 },
      { ra: 1, dec: 35 },
    ],
    [
      { ra: 3, dec: 80 },
      { ra: 14.999, dec: 80 },
    ],
    octans,
  ] as const

  it.each(examples)('follows the shorter great circle between %j and %j', (start, end) => {
    const runs = greatCirclePath(start, end, 12000)
    const points = runs.flat()
    expect(runs).toHaveLength(1)
    expect(points[0]).toEqual(start)
    expect(distance(points.at(-1)!, end)).toBeLessThan(1e-12)
    const normal = cross(unit(start), unit(end))
    const normalLength = Math.hypot(...normal)
    let totalAngle = 0
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!
      expect(Math.abs(dot(unit(point), normal)) / normalLength).toBeLessThan(1e-11)
      expect(point.dec).toBeGreaterThanOrEqual(-90)
      expect(point.dec).toBeLessThanOrEqual(90)
      if (index > 0) {
        const step = distance(points[index - 1]!, point)
        expect(step).toBeLessThanOrEqual((2 * Math.PI) / 180 + 1e-12)
        totalAngle += step
      }
    }
    expect(totalAngle).toBeCloseTo(distance(start, end), 10)
  })

  it('unwraps the 24h seam continuously in either direction', () => {
    const forward = greatCirclePath({ ra: 23, dec: 15 }, { ra: 1, dec: 20 }, 1200)[0]!
    const backward = greatCirclePath({ ra: 1, dec: 20 }, { ra: 23, dec: 15 }, 1200)[0]!
    expect(forward.at(-1)!.ra).toBeCloseTo(25)
    expect(backward.at(-1)!.ra).toBeCloseTo(-1)
    for (const run of [forward, backward]) {
      for (let index = 1; index < run.length; index += 1) {
        expect(Math.abs(run[index]!.ra - run[index - 1]!.ra)).toBeLessThan(1)
      }
    }
  })

  it('curves the Octans connection toward the south pole instead of interpolating declination', () => {
    const points = greatCirclePath(...octans, 12000)[0]!
    expect(Math.min(...points.map((point) => point.dec))).toBeLessThan(-84)
    const midpoint = interpolate(...octans, 0.5)
    expect(Math.abs(midpoint.dec - (octans[0].dec + octans[1].dec) / 2)).toBeGreaterThan(2)
  })

  it.each([-1, 1])('splits a crossing of pole %i into separate meridian runs', (sign) => {
    const start = { ra: 3, dec: sign * 80 }
    const end = { ra: 15, dec: sign * 75 }
    const runs = greatCirclePath(start, end, 100000)
    expect(runs).toHaveLength(2)
    expect(runs[0]!.at(-1)!.dec).toBe(sign * 90)
    expect(runs[1]![0]!.dec).toBe(sign * 90)
    expect(Math.abs(raDifference(runs[0]!.at(-1)!.ra, runs[1]![0]!.ra))).toBeCloseTo(12)
    let angle = 0
    for (const run of runs) {
      for (let index = 1; index < run.length; index += 1) {
        expect(run[index]!.ra).toBeCloseTo(run[0]!.ra, 8)
        angle += distance(run[index - 1]!, run[index]!)
      }
    }
    expect(angle).toBeCloseTo(distance(start, end), 10)
  })

  it('uses the limiting meridian when an endpoint is itself a pole', () => {
    const runs = greatCirclePath({ ra: 0, dec: 90 }, { ra: 7, dec: 40 }, 1200)
    expect(runs).toHaveLength(1)
    for (const point of runs[0]!) expect(point.ra).toBeCloseTo(7, 10)
  })

  it('handles coincident and antipodal endpoints deterministically without invalid coordinates', () => {
    const start = { ra: 0, dec: 0 }
    expect(greatCirclePath(start, start, 1200)).toEqual([[start]])
    const end = { ra: 12, dec: 0 }
    const first = greatCirclePath(start, end, 1200)
    expect(first).toEqual(greatCirclePath(start, end, 1200))
    let totalAngle = 0
    for (const run of first) {
      for (let index = 0; index < run.length; index += 1) {
        expect(Number.isFinite(run[index]!.ra)).toBe(true)
        expect(Number.isFinite(run[index]!.dec)).toBe(true)
        if (index > 0) totalAngle += distance(run[index - 1]!, run[index]!)
      }
    }
    expect(distance(first.flat().at(-1)!, end)).toBeLessThan(1e-12)
    expect(totalAngle).toBeCloseTo(Math.PI, 10)
  })

  it.each(examples)('stays within the requested projected tolerance for %j → %j', (start, end) => {
    const width = 18000
    const tolerance = 0.35
    const path = greatCirclePath(start, end, width, tolerance)[0]!
    let largestError = 0
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1]!
      const b = path[index]!
      const dx = ((b.ra - a.ra) * width) / 24
      const dy = ((b.dec - a.dec) * width) / 360
      for (let sample = 1; sample < 20; sample += 1) {
        const point = interpolate(a, b, sample / 20)
        const px = (raDifference(point.ra, a.ra) * width) / 24
        const py = ((point.dec - a.dec) * width) / 360
        const along = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)))
        largestError = Math.max(largestError, Math.hypot(px - along * dx, py - along * dy))
      }
    }
    expect(largestError).toBeLessThanOrEqual(tolerance)
  })

  it('adds detail when the map is enlarged and bounds pathological subdivision requests', () => {
    const small = greatCirclePath(...octans, 1200).flat()
    const large = greatCirclePath(...octans, 120000).flat()
    expect(large.length).toBeGreaterThan(small.length)
    const bounded = greatCirclePath(...octans, 1e12, 1e-12)
    expect(bounded.flat().length).toBeLessThanOrEqual(8192)
  })

  it('resolves the interior RA progression of a nearly polar arc even when its midpoint is linear', () => {
    const start = { ra: 0, dec: 89.999 }
    const end = { ra: 11.9, dec: 89.999 }
    const width = 1200
    const tolerance = 0.35
    const midpoint = interpolate(start, end, 0.5)
    const midpointError = Math.hypot(
      ((midpoint.ra - (start.ra + end.ra) / 2) * width) / 24,
      ((midpoint.dec - (start.dec + end.dec) / 2) * width) / 360,
    )
    expect(midpointError).toBeLessThan(tolerance)
    const path = greatCirclePath(start, end, width, tolerance)[0]!
    expect(path.length).toBeGreaterThan(2)
    let largestError = 0
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1]!
      const b = path[index]!
      for (let sample = 1; sample < 100; sample += 1) {
        const fraction = sample / 100
        const point = interpolate(a, b, fraction)
        const error = Math.hypot(
          ((raDifference(point.ra, a.ra) - (b.ra - a.ra) * fraction) * width) / 24,
          ((point.dec - a.dec - (b.dec - a.dec) * fraction) * width) / 360,
        )
        largestError = Math.max(largestError, error)
      }
    }
    expect(largestError).toBeLessThanOrEqual(tolerance)
  })
})

describe('right ascension grid labels', () => {
  it.each([
    [0, '00h'],
    [1, '01h'],
    [0.25, '00h15'],
    [0.125, '00h07m30s'],
    [1.125, '01h07m30s'],
    [23.875, '23h52m30s'],
    [-0.125, '23h52m30s'],
    [24.125, '00h07m30s'],
    [24, '00h'],
    [1 / 3600, '00h00m01s'],
    [7.5 / 3600, '00h00m07.5s'],
  ])('formats %f hours as %s without rounding to another minute', (ra, expected) => {
    expect(formatRaGrid(ra)).toBe(expected)
  })
})
