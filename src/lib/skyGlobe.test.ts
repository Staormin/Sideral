import { describe, expect, it } from 'vitest'
import { skyFocalLength, globeSegment, projectGlobe, unprojectGlobe } from './skyGlobe'
import {
  constrainSkyView,
  fitSkyPositions,
  forEachProjectedPosition,
  SkyIndex,
  type SkyView,
} from './skyProjection'

const view: SkyView = { projection: 'globe', ra: 0, dec: 0, width: 1000, height: 800, zoom: 1 }

describe('immersive celestial camera', () => {
  it('projects the center, north and increasing RA with the same orientation as the plane', () => {
    expect(projectGlobe({ ra: 0, dec: 0 }, view)).toEqual({ x: 500, y: 400, depth: 1 })
    expect(projectGlobe({ ra: 1, dec: 0 }, view).x).toBeLessThan(500)
    expect(projectGlobe({ ra: 0, dec: 15 }, view).y).toBeLessThan(400)
  })

  it.each([-90, -45, 0, 45, 90])('round-trips visible points at camera latitude %s', (dec) => {
    const camera = { ...view, ra: 23.8, dec }
    for (const offsetX of [-0.7, 0, 0.7]) {
      for (const offsetY of [-0.5, 0, 0.5]) {
        const point = {
          x: 500 + offsetX * skyFocalLength(camera),
          y: 400 + offsetY * skyFocalLength(camera),
        }
        const position = unprojectGlobe(point, camera)!
        const projected = projectGlobe(position, camera)
        expect(projected.x).toBeCloseTo(point.x, 7)
        expect(projected.y).toBeCloseTo(point.y, 7)
        expect(projected.depth).toBeGreaterThan(0)
      }
    }
  })

  it('excludes stars behind the camera and maps every screen corner', () => {
    const front = { ra: 0, dec: 0 },
      back = { ra: 12, dec: 0 }
    const index = new SkyIndex([front, back])
    expect(index.query(view)).toEqual([front])
    expect(index.countInView(view)).toBe(1)
    const points: unknown[] = []
    forEachProjectedPosition(back, view, (p) => points.push(p), 100)
    expect(points).toEqual([])
    for (const x of [0, view.width]) {
      for (const y of [0, view.height]) {
        const direction = unprojectGlobe({ x, y }, view)!
        expect(direction).not.toBeNull()
        const projected = projectGlobe(direction, view)
        expect(projected.x).toBeCloseTo(x, 7)
        expect(projected.y).toBeCloseTo(y, 7)
      }
    }
  })

  it('clips a segment crossing behind the camera to the screen edge', () => {
    const segment = globeSegment({ ra: 0, dec: 0 }, { ra: 7, dec: 0 }, view)!
    expect(segment).not.toBeNull()
    expect(segment[1].x).toBeCloseTo(-2)
    expect(segment[1].y).toBeCloseTo(400)
    expect(globeSegment({ ra: 10, dec: 0 }, { ra: 14, dec: 0 }, view)).toBeNull()
  })

  it('limits the widest field of view and keeps the camera at the center', () => {
    const camera = { ...view, width: 390, height: 844, zoom: 0.1, dec: 100 }
    constrainSkyView(camera)
    expect(camera.zoom).toBe(1)
    expect(camera.dec).toBe(90)
    const fieldOfView =
      (2 * Math.atan(Math.max(camera.width, camera.height) / (2 * skyFocalLength(camera))) * 180) /
      Math.PI
    expect(fieldOfView).toBeCloseTo(100)
    expect(unprojectGlobe({ x: camera.width / 2, y: camera.height / 2 }, camera)?.dec).toBeCloseTo(
      90,
    )
  })

  it('fits a visible group across the RA seam', () => {
    const positions = [
      { ra: 23, dec: 0 },
      { ra: 1, dec: 20 },
      { ra: 0, dec: -15 },
    ]
    const fitted = { ...view, ...fitSkyPositions(positions, view, 48)! }
    for (const position of positions) {
      const point = projectGlobe(position, fitted)
      expect(point.depth).toBeGreaterThan(0)
      expect(point.x).toBeGreaterThanOrEqual(48 - 1e-8)
      expect(point.x).toBeLessThanOrEqual(view.width - 48 + 1e-8)
      expect(point.y).toBeGreaterThanOrEqual(48 - 1e-8)
      expect(point.y).toBeLessThanOrEqual(view.height - 48 + 1e-8)
    }
  })
})
