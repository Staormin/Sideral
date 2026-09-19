import { raDifference, wrapRa, type SkyPosition } from './skyProjection'

type Vector = readonly [number, number, number]

const DEGREES = 180 / Math.PI
const MAX_STEP = 2 / DEGREES
const MAX_DEPTH = 20
const MAX_SEGMENTS = 4095
const POLE_EPSILON = 1e-12

function vector(position: SkyPosition): Vector {
  const longitude = (position.ra * Math.PI) / 12
  const latitude = position.dec / DEGREES
  const radius = Math.cos(latitude)
  return [radius * Math.cos(longitude), radius * Math.sin(longitude), Math.sin(latitude)]
}

function dot(a: Vector, b: Vector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vector, b: Vector): Vector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalize(value: Vector): Vector {
  const length = Math.hypot(...value)
  return [value[0] / length, value[1] / length, value[2] / length]
}

function projectedDeviation(
  point: SkyPosition,
  start: SkyPosition,
  end: SkyPosition,
  fraction: number,
  worldWidth: number,
): number {
  return Math.hypot(
    ((point.ra - start.ra - (end.ra - start.ra) * fraction) * worldWidth) / 24,
    ((point.dec - start.dec - (end.dec - start.dec) * fraction) * worldWidth) / 360,
  )
}

/**
 * Tessellates the shorter spherical arc for an equirectangular map. RA stays unwrapped
 * within each run; an exact pole crossing starts a new run instead of drawing an RA bridge.
 * Antipodal endpoints have no unique arc, so a fixed perpendicular plane is chosen.
 */
export function greatCirclePath(
  start: SkyPosition,
  end: SkyPosition,
  worldWidth: number,
  tolerance = 0.35,
): SkyPosition[][] {
  const from = vector(start)
  const to = vector(end)
  const normal = cross(from, to)
  const sine = Math.hypot(...normal)
  const cosine = Math.max(-1, Math.min(1, dot(from, to)))
  if (sine < 1e-14 && cosine > 0) return [[{ ...start }]]

  let tangent: Vector
  let angle = Math.atan2(sine, cosine)
  if (sine < 1e-14) {
    const axis: Vector =
      Math.abs(from[0]) <= Math.abs(from[1]) && Math.abs(from[0]) <= Math.abs(from[2])
        ? [1, 0, 0]
        : Math.abs(from[1]) <= Math.abs(from[2])
          ? [0, 1, 0]
          : [0, 0, 1]
    tangent = normalize(cross(axis, from))
    angle = Math.PI
  } else {
    tangent = normalize(cross(normal, from))
  }

  const scale = Number.isFinite(worldWidth) ? Math.max(1, Math.abs(worldWidth)) : 1
  const pixelTolerance = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0.35
  const boundaries = [0]
  const plane = cross(from, tangent)
  if (Math.abs(plane[2]) < POLE_EPSILON) {
    for (const sign of [-1, 1]) {
      let poleAngle = Math.atan2(sign * tangent[2], sign * from[2])
      if (poleAngle < 0) poleAngle += 2 * Math.PI
      if (poleAngle > POLE_EPSILON && poleAngle < angle - POLE_EPSILON) {
        boundaries.push(poleAngle)
      }
    }
  }
  boundaries.push(angle)
  boundaries.sort((a, b) => a - b)

  function positionAt(theta: number, referenceRa: number): SkyPosition {
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    const x = from[0] * c + tangent[0] * s
    const y = from[1] * c + tangent[1] * s
    const z = from[2] * c + tangent[2] * s
    const horizontal = Math.hypot(x, y)
    return {
      ra:
        horizontal < POLE_EPSILON
          ? referenceRa
          : referenceRa + raDifference((Math.atan2(y, x) * 12) / Math.PI, referenceRa),
      dec: horizontal < POLE_EPSILON ? Math.sign(z) * 90 : Math.atan2(z, horizontal) * DEGREES,
    }
  }

  const runs: SkyPosition[][] = []
  let previousRa = start.ra
  for (let index = 1; index < boundaries.length; index += 1) {
    const firstAngle = boundaries[index - 1] ?? 0
    const lastAngle = boundaries[index] ?? angle
    const middle = positionAt((firstAngle + lastAngle) / 2, previousRa)
    const first = positionAt(firstAngle, middle.ra)
    const last = positionAt(lastAngle, middle.ra)
    if (firstAngle === 0 && Math.abs(start.dec) < 90) {
      first.ra = start.ra
      first.dec = start.dec
    }
    if (lastAngle === angle && Math.abs(end.dec) < 90) {
      last.ra = middle.ra + raDifference(end.ra, middle.ra)
      last.dec = end.dec
    }
    const run = [first]
    let subdivisions = 0

    function subdivide(
      a: SkyPosition,
      b: SkyPosition,
      fromAngle: number,
      toAngle: number,
      depth: number,
    ): void {
      const middleAngle = (fromAngle + toAngle) / 2
      const midpoint = positionAt(middleAngle, (a.ra + b.ra) / 2)
      // Near a pole, a symmetric S-shaped RA progression can hide its error at the midpoint.
      const firstQuarter = positionAt((3 * fromAngle + toAngle) / 4, (3 * a.ra + b.ra) / 4)
      const lastQuarter = positionAt((fromAngle + 3 * toAngle) / 4, (a.ra + 3 * b.ra) / 4)
      const error = Math.max(
        projectedDeviation(firstQuarter, a, b, 0.25, scale),
        projectedDeviation(midpoint, a, b, 0.5, scale),
        projectedDeviation(lastQuarter, a, b, 0.75, scale),
      )
      if (
        depth < MAX_DEPTH &&
        subdivisions < MAX_SEGMENTS - 1 &&
        (toAngle - fromAngle > MAX_STEP || error > pixelTolerance)
      ) {
        subdivisions += 1
        subdivide(a, midpoint, fromAngle, middleAngle, depth + 1)
        subdivide(midpoint, b, middleAngle, toAngle, depth + 1)
      } else {
        run.push(b)
      }
    }

    subdivide(first, last, firstAngle, lastAngle, 0)
    runs.push(run)
    previousRa = last.ra
  }
  return runs
}

/** Grid coordinates keep seconds instead of rounding fractional minutes to another meridian. */
export function formatRaGrid(ra: number): string {
  if (!Number.isFinite(ra)) return '—'
  const totalSeconds = (Math.round(wrapRa(ra) * 3600 * 1e6) / 1e6) % 86400
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds - hours * 3600) / 60)
  const seconds = Number((totalSeconds - hours * 3600 - minutes * 60).toFixed(6))
  const hourLabel = `${String(hours).padStart(2, '0')}h`
  if (seconds !== 0) {
    const secondLabel = `${seconds < 10 ? '0' : ''}${seconds.toFixed(6).replace(/\.?0+$/, '')}`
    return `${hourLabel}${String(minutes).padStart(2, '0')}m${secondLabel}s`
  }
  return minutes === 0 ? hourLabel : `${hourLabel}${String(minutes).padStart(2, '0')}`
}
