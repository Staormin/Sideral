<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import StarScintillation from './StarScintillation.vue'
import SelectionFlow from './SelectionFlow.vue'
import { starColor, starName, starRadius } from '../lib/astronomy'
import {
  createRenderStar,
  drawStar,
  starAppearanceScale,
  StarFieldCache,
  type RenderStar,
} from '../lib/skyStarField'
import { CONSTELLATION_FIGURES } from '../lib/skyConstellations'
import { formatRaGrid, greatCirclePath } from '../lib/skyGeometry'
import { projectSkyPaths, traceSkyPaths } from '../lib/skyPaths'
import {
  constrainSkyView,
  fitSkyPositions,
  forEachProjectedPosition,
  latitudeDifference,
  MAX_ZOOM,
  minimumSkyZoom,
  normalizeSkyPosition,
  projectChartPosition,
  projectPosition,
  raDifference,
  SkyIndex,
  unprojectChartPoint,
  unprojectPoint,
  wrapRa,
  type ScreenPoint,
  type SkyPosition,
  type SkyView,
} from '../lib/skyProjection'
import type { Star } from '../types/catalog'

const props = defineProps<{
  active: boolean
  stars: Star[]
  selectedStar: Star | null
  emphasizedStar?: Star | null
  assignedStars: readonly (Star | null)[]
  animateSelection: boolean
  showGrid: boolean
  showLabels: boolean
  showConstellationLabels: boolean
  showStars: boolean
  showConstellations: boolean
}>()

const emit = defineEmits<{
  select: [star: Star]
  hover: [star: Star | null]
  'view-change': [view: { ra: number; dec: number; zoom: number; visibleCount: number }]
}>()

interface ResolvedFigure {
  code: string
  name: string
  lines: Star[][]
  paths: SkyPosition[][]
  center: { ra: number; dec: number }
}

interface StarGlowPoint extends ScreenPoint {
  key: string
  color: string
  radius: number
  phase: number
}

const canvas = ref<HTMLCanvasElement | null>(null)
const glowPoints = shallowRef<StarGlowPoint[]>([])
const emphasisPoints = shallowRef<StarGlowPoint[]>([])
const flowPaths = shallowRef<string[]>([])
const dragging = ref(false)
const hovered = ref<Star | null>(null)
const tooltip = shallowRef<{ name: string; x: number; y: number; above: boolean } | null>(null)
let tooltipTimer: ReturnType<typeof setTimeout> | undefined
const view: SkyView = { ra: 6, dec: 12, zoom: 2.3, width: 1, height: 1 }
const cursorClass = computed(() => ({
  'is-dragging': dragging.value,
  'is-hovering': hovered.value,
}))
let context: CanvasRenderingContext2D | null = null
let observer: ResizeObserver | null = null
let frame = 0
let pixelRatio = 1
let hasViewport = false
let index = new SkyIndex<RenderStar>([])
let figures: ResolvedFigure[] = []
let figureWorldWidth = 0
let selectionWorldWidth = 0
let selectionPaths: SkyPosition[][] = []
let renderStars: RenderStar[] = []
let namedStars: RenderStar[] = []
const starField = new StarFieldCache()
const MAX_CACHED_ZOOM = 3
let cacheRefreshTimer: ReturnType<typeof setTimeout> | undefined
let hoverFrame = 0
let hoverPoint: ScreenPoint | null = null
let lastEmittedView: { ra: number; dec: number; zoom: number; visibleCount: number } | null = null
const pointers = new Map<number, ScreenPoint>()
let pointerStart: ScreenPoint | null = null
let gestureMoved = false
let atDefaultView = true
const linkedStars = computed(() =>
  props.assignedStars.flatMap((star, index) =>
    star
      ? [
          {
            star,
            number: index + 1,
            color: starColor(star),
            phase: ((Math.imul(star.id, 2654435761) >>> 0) % 1000) / 1000,
          },
        ]
      : [],
  ),
)
function linkedPaths(worldWidth: number): SkyPosition[][] {
  const points = linkedStars.value.map(({ star }) => star)
  return points.flatMap((point, index) =>
    points.slice(index + 1).flatMap((next) => greatCirclePath(point, next, worldWidth)),
  )
}

function defaultZoom(): number {
  return Math.min(MAX_ZOOM, 2.3 * Math.max(1, view.height / view.width))
}

function scheduleDraw(): void {
  if (props.active && hasViewport && !frame) frame = requestAnimationFrame(draw)
}

function changeView(): void {
  constrainSkyView(view)
  cancelHover()
  setHovered(null)
  if (cacheRefreshTimer !== undefined) clearTimeout(cacheRefreshTimer)
  cacheRefreshTimer = undefined
  if (
    props.active &&
    hasViewport &&
    view.zoom <= MAX_CACHED_ZOOM &&
    starField.ready &&
    !starField.matches(view, pixelRatio)
  ) {
    // Keep scrolling responsive; reuse the previous raster while a zoom gesture is active.
    cacheRefreshTimer = setTimeout(() => {
      cacheRefreshTimer = undefined
      if (!props.active || !hasViewport) return
      starField.rebuild(renderStars, view, pixelRatio)
      scheduleDraw()
    }, 120)
  }
  scheduleDraw()
}

function setHovered(star: Star | null): void {
  if (hovered.value?.id === star?.id) return
  hovered.value = star
  emit('hover', star)
  scheduleDraw()
}

function rebuildCatalogue(): void {
  if (cacheRefreshTimer !== undefined) clearTimeout(cacheRefreshTimer)
  cacheRefreshTimer = undefined
  starField.dispose()
  figureWorldWidth = 0
  renderStars = props.stars.map(createRenderStar)
  namedStars = renderStars
    .filter(({ star }) => star.proper && star.mag < 6)
    .sort((a, b) => a.star.mag - b.star.mag)
  index = new SkyIndex(renderStars)
  const hipStars = new Map<number, Star>()
  for (const star of props.stars) {
    if (star.hip !== null && star.hip !== undefined) hipStars.set(star.hip, star)
  }
  figures = CONSTELLATION_FIGURES.flatMap((figure) => {
    // Split at unavailable catalogue entries instead of inventing a connection.
    const lines: Star[][] = []
    for (const hipLine of figure.lines) {
      let segment: Star[] = []
      for (const hip of hipLine) {
        const star = hipStars.get(hip)
        if (star) segment.push(star)
        else {
          if (segment.length > 1) lines.push(segment)
          segment = []
        }
      }
      if (segment.length > 1) lines.push(segment)
    }
    const anchors = Array.from(new Map(lines.flat().map((star) => [star.id, star])).values())
    const first = anchors[0]
    if (!first) return []
    return [
      {
        code: figure.code,
        name: figure.name.toLocaleUpperCase('fr').split('').join('\u2009'),
        lines,
        paths: [],
        center: {
          ra: wrapRa(
            first.ra +
              anchors.reduce((sum, star) => sum + raDifference(star.ra, first.ra), 0) /
                anchors.length,
          ),
          dec: anchors.reduce((sum, star) => sum + star.dec, 0) / anchors.length,
        },
      },
    ]
  })
  scheduleDraw()
}

function isInViewport(point: ScreenPoint, margin = 0): boolean {
  return (
    point.x >= -margin &&
    point.x <= view.width + margin &&
    point.y >= -margin &&
    point.y <= view.height + margin
  )
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  const raStep = view.zoom > 24 ? 0.125 : view.zoom > 10 ? 0.25 : view.zoom > 4 ? 0.5 : 1
  const decStep = view.zoom > 24 ? 2 : view.zoom > 10 ? 5 : view.zoom > 4 ? 10 : 15
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(126, 144, 163, 0.10)'
  ctx.fillStyle = 'rgba(146, 158, 175, 0.52)'
  ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace'
  ctx.textBaseline = 'top'
  const worldWidth = view.width * view.zoom
  const halfDec = (view.height / worldWidth) * 180
  const minLatitude = Math.max(-90, view.dec - halfDec)
  const maxLatitude = Math.min(90, view.dec + halfDec)
  const top = view.height / 2 + ((view.dec - 90) / 360) * worldWidth
  const bottom = top + worldWidth / 2
  const labelY = Math.max(15, top + 12)
  ctx.beginPath()
  for (let ra = 0; ra < 24; ra += raStep) {
    const { x } = projectChartPosition({ ra, dec: view.dec }, view)
    if (x < 0 || x > view.width) continue
    ctx.moveTo(Math.round(x) + 0.5, Math.max(0, top))
    ctx.lineTo(Math.round(x) + 0.5, Math.min(view.height, bottom))
    if (labelY < Math.min(view.height - 25, bottom - 14))
      ctx.fillText(formatRaGrid(ra), x + 8, labelY)
  }
  for (
    let latitude = Math.ceil(minLatitude / decStep) * decStep;
    latitude <= maxLatitude;
    latitude += decStep
  ) {
    const y = view.height / 2 + ((view.dec - latitude) / 360) * worldWidth
    const dec = normalizeSkyPosition({ ra: view.ra, dec: latitude }).dec
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(view.width, Math.round(y) + 0.5)
    if (y > 35) ctx.fillText(`${dec > 0 ? '+' : ''}${dec}°`, 15, y + 8)
  }
  ctx.stroke()

  ctx.strokeStyle = 'rgba(176, 160, 121, 0.18)'
  ctx.setLineDash([3, 7])
  ctx.beginPath()
  for (
    let latitude = Math.ceil(minLatitude / 180) * 180;
    latitude <= maxLatitude;
    latitude += 180
  ) {
    const y = view.height / 2 + ((view.dec - latitude) / 360) * worldWidth
    ctx.moveTo(0, y)
    ctx.lineTo(view.width, y)
  }
  ctx.stroke()
  ctx.setLineDash([])
}

function drawConstellations(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = 'rgba(145, 158, 181, 0.25)'
  ctx.lineWidth = 0.75
  ctx.beginPath()
  const worldWidth = view.width * view.zoom
  if (figureWorldWidth !== worldWidth) {
    for (const figure of figures) {
      figure.paths = figure.lines.flatMap((line) =>
        line.flatMap((star, index) => {
          const next = line[index + 1]
          return next ? greatCirclePath(star, next, worldWidth) : []
        }),
      )
    }
    figureWorldWidth = worldWidth
  }
  for (const figure of figures) traceSkyPaths(ctx, figure.paths, view)
  ctx.stroke()
  if (!props.showConstellationLabels) return
  ctx.font = '500 10px "Manrope Variable", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(151, 162, 181, 0.38)'
  for (const figure of figures) {
    forEachProjectedPosition(
      figure.center,
      view,
      (point) => ctx.fillText(figure.name, point.x, point.y - 28),
      50,
    )
  }
  ctx.textAlign = 'left'
}

function currentSelectionPaths(): SkyPosition[][] {
  const worldWidth = view.width * view.zoom
  if (selectionWorldWidth !== worldWidth) {
    selectionPaths = linkedPaths(worldWidth)
    selectionWorldWidth = worldWidth
  }
  return selectionPaths
}

function updateSelectionFlow(): void {
  const paths =
    props.animateSelection && linkedStars.value.length === 3
      ? projectSkyPaths(currentSelectionPaths(), view)
      : []
  if (
    paths.length !== flowPaths.value.length ||
    paths.some((path, index) => path !== flowPaths.value[index])
  ) {
    flowPaths.value = paths
  }
}

function drawSelectionLines(ctx: CanvasRenderingContext2D): void {
  if (linkedStars.value.length < 2) return
  ctx.save()
  ctx.strokeStyle = 'rgba(224, 191, 133, 0.8)'
  ctx.lineWidth = 1.25
  ctx.beginPath()
  traceSkyPaths(ctx, currentSelectionPaths(), view)
  ctx.stroke()
  ctx.restore()
}

function drawSelectionMarkers(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  for (const { star, number, color } of linkedStars.value) {
    const radius = starRadius(star.mag, view.zoom) + 5
    forEachProjectedPosition(
      star,
      view,
      (point) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.25
        ctx.beginPath()
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
        ctx.stroke()
        const x = point.x - radius - 8
        const y = point.y - radius - 6
        ctx.fillStyle = '#101925'
        ctx.beginPath()
        ctx.arc(x, y, 9, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = color
        ctx.fillText(String(number), x, y)
      },
      30,
    )
  }
  ctx.restore()
}

function updateEmphasis(): void {
  const star = props.emphasizedStar
  if (!star && emphasisPoints.value.length === 0) return
  const points: StarGlowPoint[] = []
  if (star) {
    let copy = 0
    forEachProjectedPosition(
      star,
      view,
      ({ x, y }) => {
        points.push({
          key: `${star.id}:${copy++}`,
          x,
          y,
          color: starColor(star),
          radius: starRadius(star.mag, view.zoom),
          phase: 0,
        })
      },
      180,
    )
  }
  emphasisPoints.value = points
}

function updateStarGlows(): void {
  const points: StarGlowPoint[] = []
  for (const { star, color, phase } of linkedStars.value) {
    const radius = starRadius(star.mag, view.zoom)
    let copy = 0
    forEachProjectedPosition(
      star,
      view,
      ({ x, y }) => {
        points.push({ key: `${star.id}:${copy++}`, x, y, color, radius, phase })
      },
      64,
    )
  }
  const current = glowPoints.value
  if (
    points.length === current.length &&
    points.every((point, index) => {
      const previous = current[index]
      return (
        previous &&
        point.key === previous.key &&
        point.x === previous.x &&
        point.y === previous.y &&
        point.color === previous.color &&
        point.radius === previous.radius &&
        point.phase === previous.phase
      )
    })
  )
    return
  glowPoints.value = points
}

function drawStarLabels(ctx: CanvasRenderingContext2D): void {
  const occupied: { x: number; y: number; width: number }[] = []
  ctx.font = '12px "Manrope Variable", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(204, 210, 222, 0.74)'
  for (const entry of namedStars) {
    if (entry.star.mag >= (view.zoom > 7 ? 6 : 3.3)) break
    const text = starName(entry.star)
    const width = ctx.measureText(text).width
    forEachProjectedPosition(entry, view, (point) => {
      if (occupied.length >= 36) return
      const box = {
        x: point.x + starRadius(entry.star.mag, view.zoom) + 9,
        y: point.y - 1,
        width,
      }
      if (
        box.x < 8 ||
        box.x + box.width > view.width - 10 ||
        box.y < 35 ||
        box.y > view.height - 22
      )
        return
      if (
        occupied.some(
          (other) =>
            Math.abs(other.y - box.y) < 20 &&
            box.x < other.x + other.width + 12 &&
            box.x + box.width + 12 > other.x,
        )
      )
        return
      ctx.fillText(text, box.x, box.y)
      occupied.push(box)
    })
    if (occupied.length >= 36) break
  }
}

function drawMarker(ctx: CanvasRenderingContext2D, star: Star, persistent: boolean): void {
  const radius = starRadius(star.mag, view.zoom) + (persistent ? 9 : 6)
  ctx.strokeStyle = persistent ? '#d5bd87' : 'rgba(228, 218, 197, 0.7)'
  ctx.lineWidth = 1
  forEachProjectedPosition(
    star,
    view,
    (point) => {
      ctx.beginPath()
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
      ctx.stroke()
      if (persistent) {
        ctx.beginPath()
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2) {
          ctx.moveTo(
            point.x + Math.cos(angle) * (radius + 3),
            point.y + Math.sin(angle) * (radius + 3),
          )
          ctx.lineTo(
            point.x + Math.cos(angle) * (radius + 7),
            point.y + Math.sin(angle) * (radius + 7),
          )
        }
        ctx.stroke()
      }
    },
    30,
  )
}

function draw(): void {
  frame = 0
  const ctx = context
  if (!props.active || !hasViewport || !ctx || !canvas.value) return
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  ctx.clearRect(0, 0, view.width, view.height)
  if (props.showGrid) drawGrid(ctx)
  if (props.showConstellations) drawConstellations(ctx)
  drawSelectionLines(ctx)
  let visibleCount = 0
  if (props.showStars) {
    const useCache = view.zoom <= MAX_CACHED_ZOOM
    if (useCache && !starField.ready) starField.rebuild(renderStars, view, pixelRatio)
    if (useCache && starField.ready) {
      starField.draw(ctx, view)
      visibleCount = index.countInView(view)
    } else {
      const appearance = starAppearanceScale(view.zoom)
      index.forEachInView(
        view,
        (entry) => {
          let visible = false
          forEachProjectedPosition(
            entry,
            view,
            (point) => {
              if (isInViewport(point)) visible = true
              drawStar(ctx, entry, point.x, point.y, appearance)
            },
            12,
          )
          if (visible) visibleCount += 1
        },
        24,
      )
    }
    if (props.showLabels) drawStarLabels(ctx)
    drawSelectionMarkers(ctx)
    if (hovered.value) drawMarker(ctx, hovered.value, false)
    if (props.selectedStar) drawMarker(ctx, props.selectedStar, true)
  }
  updateStarGlows()
  updateEmphasis()
  updateSelectionFlow()
  const center = normalizeSkyPosition(view)
  if (
    lastEmittedView?.ra !== center.ra ||
    lastEmittedView.dec !== center.dec ||
    lastEmittedView.zoom !== view.zoom ||
    lastEmittedView.visibleCount !== visibleCount
  ) {
    lastEmittedView = { ...center, zoom: view.zoom, visibleCount }
    emit('view-change', lastEmittedView)
  }
}

function zoomAt(
  nextZoom: number,
  point: ScreenPoint = { x: view.width / 2, y: view.height / 2 },
): void {
  const clampedZoom = Math.max(minimumSkyZoom(view), Math.min(MAX_ZOOM, nextZoom))
  if (clampedZoom === view.zoom) return
  atDefaultView = false
  const anchor = unprojectChartPoint(point, view)
  view.zoom = clampedZoom
  const after = unprojectChartPoint(point, view)
  view.ra += raDifference(anchor.ra, after.ra)
  view.dec += latitudeDifference(anchor.dec, after.dec)
  changeView()
}

function zoomIn(): void {
  zoomAt(view.zoom * 1.5)
}
function zoomOut(): void {
  zoomAt(view.zoom / 1.5)
}
function setZoom(zoom: number): void {
  if (Number.isFinite(zoom)) zoomAt(zoom)
}
function resetView(): void {
  atDefaultView = true
  view.ra = 6
  view.dec = 12
  view.zoom = defaultZoom()
  changeView()
}
function focusStar(star: Star): void {
  atDefaultView = false
  view.ra = star.ra
  view.dec = star.dec
  view.zoom = Math.max(view.zoom, 4.5)
  changeView()
}

function focusConstellation(code: string): void {
  const figure = figures.find((entry) => entry.code === code)
  if (!figure) return
  // Include the curved arcs' extrema, not only their stellar endpoints.
  const positions = figure.lines.flatMap((line) =>
    line.flatMap((star, index) => {
      const next = line[index + 1]
      return next ? greatCirclePath(star, next, view.width * MAX_ZOOM).flat() : [star]
    }),
  )
  const target = fitSkyPositions(positions, view)
  if (!target) return
  atDefaultView = false
  Object.assign(view, target)
  changeView()
  canvas.value?.focus({ preventScroll: true })
}

function focusSelection(): void {
  if (linkedStars.value.length < 2) return
  const positions = [
    ...linkedStars.value.map(({ star }) => star),
    ...linkedPaths(view.width * MAX_ZOOM).flat(),
  ]
  const target = fitSkyPositions(positions, view, 64)
  if (!target) return
  atDefaultView = false
  Object.assign(view, target)
  changeView()
}

function panBy(dx: number, dy: number): void {
  const ra = wrapRa(view.ra + (dx / (view.width * view.zoom)) * 24)
  const dec = Math.max(-90, Math.min(90, view.dec + (dy / (view.width * view.zoom)) * 360))
  if (ra === view.ra && dec === view.dec) return
  atDefaultView = false
  view.ra = ra
  view.dec = dec
  changeView()
}

function localPoint(event: { clientX: number; clientY: number }): ScreenPoint {
  const bounds = canvas.value?.getBoundingClientRect()
  return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) }
}

function findStar(point: ScreenPoint): Star | null {
  if (!props.showStars) return null
  const position = unprojectPoint(point, view)
  if (Math.abs(position.dec) > 90) return null
  const searchView: SkyView = {
    ...position,
    width: 40,
    height: 40,
    zoom: (view.width * view.zoom) / 40,
  }
  let best: Star | null = null
  let bestScore = Number.POSITIVE_INFINITY
  const radiusScale = starAppearanceScale(view.zoom).radius
  index.forEachInView(searchView, (entry) => {
    const projected = projectPosition(entry, searchView)
    const distance = Math.hypot(
      projected.x - searchView.width / 2,
      projected.y - searchView.height / 2,
    )
    const radius = entry.baseRadius * radiusScale
    // Respect the visible disk: a faint neighbour must not steal a click inside
    // a bright star. Coincident disks resolve to their brighter visible source.
    const score = Math.max(0, distance - radius) / (3 + radius)
    const closer =
      score < bestScore || (score === bestScore && entry.star.mag < (best?.mag ?? Infinity))
    if (distance <= Math.max(8, radius + 5) && closer) {
      best = entry.star
      bestScore = score
    }
  })
  return best
}

function cancelHover(): void {
  clearTimeout(tooltipTimer)
  tooltipTimer = undefined
  tooltip.value = null
  if (hoverFrame) cancelAnimationFrame(hoverFrame)
  hoverFrame = 0
  hoverPoint = null
}

function requestHover(point: ScreenPoint): void {
  clearTimeout(tooltipTimer)
  tooltip.value = null
  tooltipTimer = setTimeout(() => {
    tooltipTimer = undefined
    if (!props.active || dragging.value) return
    const star = findStar(point)
    if (!star) return
    tooltip.value = {
      name: starName(star),
      x: Math.max(8, Math.min(point.x + 14, view.width - 248)),
      y: point.y > view.height - 60 ? point.y - 14 : point.y + 18,
      above: point.y > view.height - 60,
    }
  }, 500)
  hoverPoint = point
  if (!hoverFrame) {
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0
      if (hoverPoint) setHovered(findStar(hoverPoint))
      hoverPoint = null
    })
  }
}

function selectStar(star: Star): void {
  emit('select', star)
  scheduleDraw()
}

function onWheel(event: WheelEvent): void {
  if (event.deltaY === 0) return
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1
  zoomAt(view.zoom * Math.exp(-event.deltaY * unit * 0.002), localPoint(event))
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  const point = localPoint(event)
  canvas.value?.focus({ preventScroll: true })
  canvas.value?.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, point)
  if (pointers.size === 1) {
    pointerStart = point
    gestureMoved = false
  } else gestureMoved = true
  dragging.value = true
  cancelHover()
  setHovered(null)
}

function onPointerMove(event: PointerEvent): void {
  const point = localPoint(event)
  const previous = pointers.get(event.pointerId)
  if (!previous) {
    if (event.pointerType !== 'touch') requestHover(point)
    return
  }
  const before = [...pointers.values()]
  pointers.set(event.pointerId, point)
  if (pointerStart && Math.hypot(point.x - pointerStart.x, point.y - pointerStart.y) > 4)
    gestureMoved = true
  if (pointers.size > 1) {
    const after = [...pointers.values()]
    const a = before[0]
    const b = before[1]
    const c = after[0]
    const d = after[1]
    if (!a || !b || !c || !d) return
    const oldDistance = Math.hypot(a.x - b.x, a.y - b.y)
    const newDistance = Math.hypot(c.x - d.x, c.y - d.y)
    const midpoint = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 }
    panBy(midpoint.x - (a.x + b.x) / 2, midpoint.y - (a.y + b.y) / 2)
    if (oldDistance > 0) zoomAt((view.zoom * newDistance) / oldDistance, midpoint)
  } else if (gestureMoved) panBy(point.x - previous.x, point.y - previous.y)
}

function onPointerUp(event: PointerEvent): void {
  if (!pointers.has(event.pointerId)) return
  pointers.delete(event.pointerId)
  if (canvas.value?.hasPointerCapture(event.pointerId))
    canvas.value.releasePointerCapture(event.pointerId)
  if (!pointers.size) {
    dragging.value = false
    if (!gestureMoved) {
      const star = findStar(localPoint(event))
      if (star) selectStar(star)
    }
    pointerStart = null
  }
}

function onPointerCancel(event: PointerEvent): void {
  pointers.delete(event.pointerId)
  if (!pointers.size) {
    dragging.value = false
    pointerStart = null
  }
  gestureMoved = true
}

function onPointerLeave(): void {
  if (!pointers.size) {
    cancelHover()
    setHovered(null)
  }
}

function onKeyDown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 160 : 55
  switch (event.key) {
    case 'Escape':
      cancelHover()
      setHovered(null)
      break
    case 'ArrowLeft':
      panBy(step, 0)
      break
    case 'ArrowRight':
      panBy(-step, 0)
      break
    case 'ArrowUp':
      panBy(0, step)
      break
    case 'ArrowDown':
      panBy(0, -step)
      break
    case '+':
    case '=':
      zoomIn()
      break
    case '-':
    case '_':
      zoomOut()
      break
    case 'Home':
      resetView()
      break
    case 'Enter':
    case ' ': {
      if (!props.showStars) break
      let nearest: Star | null = null
      let distance = Number.POSITIVE_INFINITY
      index.forEachInView(
        view,
        (entry) => {
          forEachProjectedPosition(
            entry,
            view,
            (point) => {
              const nextDistance = Math.hypot(point.x - view.width / 2, point.y - view.height / 2)
              if (nextDistance < distance) {
                nearest = entry.star
                distance = nextDistance
              }
            },
            12,
          )
        },
        24,
      )
      if (nearest) selectStar(nearest)
      break
    }
    default:
      return
  }
  event.preventDefault()
}

function resize(): void {
  const element = canvas.value
  if (!element || !props.active) return
  const bounds = element.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) {
    hasViewport = false
    return
  }
  const nextPixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const unchanged =
    hasViewport &&
    view.width === bounds.width &&
    view.height === bounds.height &&
    pixelRatio === nextPixelRatio
  hasViewport = true
  if (unchanged) {
    scheduleDraw()
    return
  }
  view.width = bounds.width
  view.height = bounds.height
  if (atDefaultView) {
    view.ra = 6
    view.dec = 12
    view.zoom = defaultZoom()
  }
  pixelRatio = nextPixelRatio
  element.width = Math.round(view.width * pixelRatio)
  element.height = Math.round(view.height * pixelRatio)
  changeView()
}

watch(
  () => props.active,
  (active) => {
    if (active) {
      resize()
      return
    }
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (cacheRefreshTimer !== undefined) clearTimeout(cacheRefreshTimer)
    cacheRefreshTimer = undefined
    cancelHover()
    setHovered(null)
    pointers.clear()
    dragging.value = false
    pointerStart = null
  },
  { flush: 'post' },
)

watch(() => props.stars, rebuildCatalogue)
watch(() => props.animateSelection, updateSelectionFlow)
watch(() => props.emphasizedStar, scheduleDraw)
watch(
  () => props.showStars,
  () => {
    cancelHover()
    setHovered(null)
    scheduleDraw()
  },
)
watch(
  () => props.assignedStars,
  () => {
    selectionWorldWidth = 0
    focusSelection()
    scheduleDraw()
  },
)
watch(
  () => props.selectedStar,
  () => {
    cancelHover()
    setHovered(null)
    scheduleDraw()
  },
)
watch(
  () => [props.showGrid, props.showLabels, props.showConstellations, props.showConstellationLabels],
  () => {
    setHovered(null)
    scheduleDraw()
  },
)

onMounted(() => {
  context = canvas.value?.getContext('2d', { alpha: true }) ?? null
  observer = new ResizeObserver(resize)
  if (canvas.value) observer.observe(canvas.value)
  window.addEventListener('resize', resize)
  rebuildCatalogue()
  resize()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', resize)
  if (frame) cancelAnimationFrame(frame)
  cancelHover()
  if (cacheRefreshTimer !== undefined) clearTimeout(cacheRefreshTimer)
  starField.dispose()
  pointers.clear()
})

defineExpose({ zoomIn, zoomOut, resetView, focusStar, focusConstellation, setZoom })
</script>

<template>
  <div class="sky-map">
    <canvas
      ref="canvas"
      class="sky-map__canvas"
      :class="cursorClass"
      tabindex="0"
      role="application"
      aria-label="Carte interactive des étoiles, coordonnées équatoriales J2000"
      :aria-describedby="tooltip ? 'sky-map-instructions sky-star-tooltip' : 'sky-map-instructions'"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @lostpointercapture="onPointerCancel"
      @pointerleave="onPointerLeave"
      @blur="cancelHover"
      @keydown="onKeyDown"
      @dblclick.prevent="zoomAt(view.zoom * 1.8, localPoint($event))"
    >
      Carte du ciel : utilisez la recherche d’étoiles pour consulter le catalogue si votre
      navigateur ne prend pas en charge le canvas.
    </canvas>
    <div
      v-if="tooltip"
      id="sky-star-tooltip"
      class="sky-map__tooltip"
      role="tooltip"
      :style="{
        left: `${tooltip.x}px`,
        top: `${tooltip.y}px`,
        transform: tooltip.above ? 'translateY(-100%)' : undefined,
      }"
    >
      {{ tooltip.name }}
    </div>
    <SelectionFlow v-if="active && animateSelection && flowPaths.length" :paths="flowPaths" />
    <StarScintillation v-if="active && showStars" :points="glowPoints" />
    <StarScintillation
      v-if="active && showStars && emphasisPoints.length"
      :points="emphasisPoints"
      intense
    />
    <span id="sky-map-instructions" class="sky-map__instructions">
      Glissez pour déplacer la carte. Molette, pincement ou touches plus et moins pour zoomer. Les
      flèches déplacent la carte. Entrée sélectionne l’étoile la plus proche du centre. La touche
      Début rétablit la vue initiale.
    </span>
    <div class="sky-map__focus-cross" aria-hidden="true"><span></span><span></span></div>
  </div>
</template>

<style scoped>
.sky-map {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 64% 43%, rgb(27 40 57 / 29%), transparent 57%),
    radial-gradient(ellipse at 24% 84%, rgb(29 36 51 / 18%), transparent 42%), #080e18;
}

.sky-map::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background: radial-gradient(ellipse at 54% 45%, transparent 30%, rgb(3 7 13 / 18%) 100%);
}

.sky-map__canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  outline: none;
  touch-action: none;
  user-select: none;
}

.sky-map__canvas.is-hovering {
  cursor: pointer;
}

.sky-map__canvas.is-dragging {
  cursor: grabbing;
}

.sky-map__tooltip {
  position: absolute;
  z-index: 4;
  max-width: min(240px, calc(100% - 16px));
  padding: 8px 12px;
  color: #eee5d8;
  overflow-wrap: anywhere;
  pointer-events: none;
  background: #101823f2;
  border: 1px solid #d7bc8c55;
  border-radius: 6px;
  box-shadow: 0 4px 16px #0006;
  font-size: 13px;
  line-height: 1.4;
}

.sky-map__instructions {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.sky-map__focus-cross {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 12px;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, -50%);
}

.sky-map__canvas:focus-visible ~ .sky-map__focus-cross {
  opacity: 0.7;
}

.sky-map__focus-cross span {
  position: absolute;
  background: #d5bd87;
}

.sky-map__focus-cross span:first-child {
  top: 5px;
  width: 12px;
  height: 1px;
}

.sky-map__focus-cross span:last-child {
  left: 5px;
  width: 1px;
  height: 12px;
}
</style>
