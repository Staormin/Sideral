import { starColor, starRadius } from './astronomy'
import { wrapRa, type SkyView } from './skyProjection'
import type { Star } from '../types/catalog'

export interface RenderStar {
  ra: number
  dec: number
  star: Star
  color: string
  baseRadius: number
  baseAlpha: number
}

export interface StarAppearanceScale {
  radius: number
  exposure: number
  minAlpha: number
}

export function createRenderStar(star: Star): RenderStar {
  return {
    ra: star.ra,
    dec: star.dec,
    star,
    color: starColor(star),
    baseRadius: starRadius(star.mag, 1),
    baseAlpha: Math.exp(-0.31 * Math.max(0, star.mag - 2.3)),
  }
}

/** The zoom-dependent terms are shared by every star in a frame. */
export function starAppearanceScale(zoom: number): StarAppearanceScale {
  const exposure = (zoom / 2.3) ** 0.35
  return {
    radius: Math.min(1.75, Math.max(0.85, zoom ** 0.12)),
    exposure,
    minAlpha: 0.055 * Math.min(2.5, exposure),
  }
}

export function drawStar(
  ctx: CanvasRenderingContext2D,
  entry: RenderStar,
  x: number,
  y: number,
  scale: StarAppearanceScale,
): void {
  const magnitude = entry.star.mag
  const radius = entry.baseRadius * scale.radius
  const alpha = Math.min(1, Math.max(scale.minAlpha, entry.baseAlpha * scale.exposure))
  ctx.fillStyle = entry.color
  if (magnitude < 2.6) {
    const haloSize = radius * (magnitude < 1 ? 8 : 5)
    const glow = ctx.createRadialGradient(x, y, radius * 0.3, x, y, haloSize)
    glow.addColorStop(0, `${entry.color}40`)
    glow.addColorStop(0.23, `${entry.color}14`)
    glow.addColorStop(1, `${entry.color}00`)
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, haloSize, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = entry.color
  }
  ctx.globalAlpha = alpha
  if (radius < 0.8) {
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  } else {
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  if (magnitude < 1.1) {
    ctx.globalAlpha = 0.38
    ctx.fillRect(x - radius * 2.7, y - 0.35, radius * 5.4, 0.7)
    ctx.fillRect(x - 0.35, y - radius * 2.7, 0.7, radius * 5.4)
    ctx.globalAlpha = 0.86
    ctx.fillStyle = '#fff9ed'
    ctx.beginPath()
    ctx.arc(x, y, radius * 0.38, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// A single transparent RGBA layer stays below 32 MiB, including its polar gutters.
export const MAX_RASTER_PIXELS = 8_000_000

export interface StarRasterLayout {
  worldWidth: number
  height: number
  gutter: number
  pixelWidth: number
  pixelHeight: number
}

export function getRasterLayout(view: SkyView, pixelRatio: number): StarRasterLayout {
  const worldWidth = Math.max(1, view.width * view.zoom)
  // starRadius caps the base radius at 4.8; the brightest halo extends to 8 radii.
  const gutter = Math.ceil(4.8 * starAppearanceScale(view.zoom).radius * 8 + 2)
  const height = worldWidth / 2 + 2 * gutter
  const ratio = Math.min(pixelRatio, Math.sqrt(MAX_RASTER_PIXELS / (worldWidth * height)))
  return {
    worldWidth,
    height,
    gutter,
    pixelWidth: Math.max(1, Math.floor(worldWidth * ratio)),
    pixelHeight: Math.max(1, Math.floor(height * ratio)),
  }
}

/** An equatorial raster of every catalogue star, independent of the viewport center. */
export class StarFieldCache {
  private canvas: HTMLCanvasElement | null = null
  private layout: StarRasterLayout | null = null
  private zoom = 0
  private pixelRatio = 0

  get ready(): boolean {
    return this.canvas !== null && this.layout !== null
  }

  matches(view: SkyView, pixelRatio: number): boolean {
    return (
      this.ready &&
      this.layout?.worldWidth === view.width * view.zoom &&
      this.zoom === view.zoom &&
      this.pixelRatio === pixelRatio
    )
  }

  rebuild(stars: readonly RenderStar[], view: SkyView, pixelRatio: number): void {
    const layout = getRasterLayout(view, pixelRatio)
    const canvas = this.canvas ?? document.createElement('canvas')
    canvas.width = layout.pixelWidth
    canvas.height = layout.pixelHeight
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) {
      this.dispose()
      return
    }
    ctx.setTransform(
      layout.pixelWidth / layout.worldWidth,
      0,
      0,
      layout.pixelHeight / layout.height,
      0,
      0,
    )
    const scale = starAppearanceScale(view.zoom)
    for (const entry of stars) {
      const x = layout.worldWidth * (1 - wrapRa(entry.ra) / 24)
      const y = ((90 - entry.dec) * layout.worldWidth) / 360 + layout.gutter
      drawStar(ctx, entry, x, y, scale)
      const radius = entry.baseRadius * scale.radius
      const extent = radius * (entry.star.mag < 1 ? 8 : entry.star.mag < 2.6 ? 5 : 1)
      // The raster wraps at 0h; keep the other half of disks and halos at both edges.
      if (x - extent < 0) drawStar(ctx, entry, x + layout.worldWidth, y, scale)
      if (x + extent > layout.worldWidth) drawStar(ctx, entry, x - layout.worldWidth, y, scale)
    }
    this.canvas = canvas
    this.layout = layout
    this.zoom = view.zoom
    this.pixelRatio = pixelRatio
  }

  draw(ctx: CanvasRenderingContext2D, view: SkyView): void {
    const { canvas, layout } = this
    if (!canvas || !layout) return
    const worldWidth = view.width * view.zoom
    const worldHeight = worldWidth / 2
    const ratio = worldWidth / layout.worldWidth
    const rasterHeight = layout.height * ratio
    const offset = view.width / 2 - (1 - wrapRa(view.ra) / 24) * worldWidth
    const top = view.height / 2 + ((view.dec - 90) * worldWidth) / 360 - layout.gutter * ratio
    // Beyond either pole, latitude reflects and right ascension advances by 12h.
    // The two orientations repeat together after 360°, not after 180°.
    for (const reflected of [false, true]) {
      const stripOffset = offset - (reflected ? worldWidth / 2 : 0)
      const firstX = stripOffset + Math.floor(-stripOffset / worldWidth) * worldWidth
      const stripTop = top - (reflected ? worldHeight : 0)
      // Include preceding strips whose polar halos still intersect the viewport.
      const firstY =
        stripTop + (Math.floor((-stripTop - rasterHeight) / worldWidth) + 1) * worldWidth
      for (let y = firstY; y < view.height; y += worldWidth) {
        if (reflected) {
          ctx.save()
          ctx.translate(0, y + rasterHeight)
          ctx.scale(1, -1)
        }
        for (let x = firstX; x < view.width; x += worldWidth) {
          ctx.drawImage(canvas, x, reflected ? 0 : y, worldWidth, rasterHeight)
        }
        if (reflected) ctx.restore()
      }
    }
  }

  dispose(): void {
    if (this.canvas) {
      this.canvas.width = 1
      this.canvas.height = 1
    }
    this.canvas = null
    this.layout = null
    this.zoom = 0
    this.pixelRatio = 0
  }
}
