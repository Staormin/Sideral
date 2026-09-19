import type { ScreenPoint, SkyPosition, SkyView } from './skyProjection'

const RAD = Math.PI / 180
const vectors = new WeakMap<SkyPosition, readonly [number, number, number]>()
let cameraRa = NaN
let cameraDec = NaN
let camera = { sinRa: 0, cosRa: 1, sinDec: 0, cosDec: 1 }

function vector(position: SkyPosition): readonly [number, number, number] {
  let cached = vectors.get(position)
  if (!cached) {
    const ra = position.ra * 15 * RAD
    const dec = position.dec * RAD
    cached = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
    vectors.set(position, cached)
  }
  return cached
}

/** Focal length for a camera at the center; the widest field of view is 100 degrees. */
export function skyFocalLength(view: SkyView): number {
  return Math.max(1, Math.max(view.width, view.height) / (2 * Math.tan(50 * RAD))) * view.zoom
}

function cameraPosition(position: SkyPosition, view: SkyView) {
  if (view.ra !== cameraRa || view.dec !== cameraDec) {
    cameraRa = view.ra
    cameraDec = view.dec
    camera = {
      sinRa: Math.sin(view.ra * 15 * RAD),
      cosRa: Math.cos(view.ra * 15 * RAD),
      sinDec: Math.sin(view.dec * RAD),
      cosDec: Math.cos(view.dec * RAD),
    }
  }
  const [x, y, z] = vector(position)
  const forward = x * camera.cosRa + y * camera.sinRa
  return {
    x: x * camera.sinRa - y * camera.cosRa,
    y: z * camera.cosDec - forward * camera.sinDec,
    depth: forward * camera.cosDec + z * camera.sinDec,
  }
}

/** Perspective from inside the celestial sphere, with north up and RA increasing left. */
export function projectGlobe(
  position: SkyPosition,
  view: SkyView,
): ScreenPoint & { depth: number } {
  const point = cameraPosition(position, view)
  const scale = skyFocalLength(view) / Math.max(1e-6, point.depth)
  return {
    x: view.width / 2 + scale * point.x,
    y: view.height / 2 - scale * point.y,
    depth: point.depth,
  }
}

/** Every point in the viewport maps to a viewing direction, including its corners. */
export function unprojectGlobe(point: ScreenPoint, view: SkyView): SkyPosition | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  const focal = skyFocalLength(view)
  const east = -(point.x - view.width / 2) / focal
  const north = -(point.y - view.height / 2) / focal
  const length = Math.hypot(east, north, 1)
  const dec = view.dec * RAD
  const latitude = Math.asin(
    Math.max(-1, Math.min(1, (north * Math.cos(dec) + Math.sin(dec)) / length)),
  )
  const longitude = view.ra * 15 * RAD + Math.atan2(east, Math.cos(dec) - north * Math.sin(dec))
  return { ra: (((longitude / RAD / 15) % 24) + 24) % 24, dec: latitude / RAD }
}

export function globeSegment(
  a: SkyPosition,
  b: SkyPosition,
  view: SkyView,
): [ScreenPoint, ScreenPoint] | null {
  let start = cameraPosition(a, view)
  let end = cameraPosition(b, view)
  const near = 1e-6
  if (start.depth < near && end.depth < near) return null
  if (start.depth < near !== end.depth < near) {
    const t = (near - start.depth) / (end.depth - start.depth)
    const edge = {
      x: start.x + t * (end.x - start.x),
      y: start.y + t * (end.y - start.y),
      depth: near,
    }
    if (start.depth < near) start = edge
    else end = edge
  }
  const focal = skyFocalLength(view)
  const first = {
    x: view.width / 2 + (focal * start.x) / start.depth,
    y: view.height / 2 - (focal * start.y) / start.depth,
  }
  const last = {
    x: view.width / 2 + (focal * end.x) / end.depth,
    y: view.height / 2 - (focal * end.y) / end.depth,
  }
  // Clip in screen space before submitting paths, avoiding enormous coordinates near 90 degrees.
  const dx = last.x - first.x,
    dy = last.y - first.y
  let enter = 0,
    leave = 1
  for (const [p, q] of [
    [-dx, first.x + 2],
    [dx, view.width + 2 - first.x],
    [-dy, first.y + 2],
    [dy, view.height + 2 - first.y],
  ]) {
    if (p === 0) {
      if (q! < 0) return null
      continue
    }
    const t = q! / p!
    if (p! < 0) enter = Math.max(enter, t)
    else leave = Math.min(leave, t)
    if (enter > leave) return null
  }
  return [
    { x: first.x + enter * dx, y: first.y + enter * dy },
    { x: first.x + leave * dx, y: first.y + leave * dy },
  ]
}
