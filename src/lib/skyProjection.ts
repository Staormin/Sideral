/** Equatorial J2000 projection: north up; right ascension increases to the left. */
export interface SkyPosition {
  ra: number
  dec: number
}

export interface SkyView extends SkyPosition {
  width: number
  height: number
  zoom: number
}

export interface ScreenPoint {
  x: number
  y: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 96
const SCREEN_EDGE_EPSILON = 1e-7

/** Keep the entire viewport between the two poles, including on portrait screens. */
export function minimumSkyZoom(view: Pick<SkyView, 'width' | 'height'>): number {
  return Math.max(MIN_ZOOM, (2 * view.height) / Math.max(1, view.width))
}

export function constrainSkyView(view: SkyView): void {
  view.zoom = Math.max(minimumSkyZoom(view), Math.min(MAX_ZOOM, view.zoom))
  const limit = Math.max(0, 90 - (180 * view.height) / (Math.max(1, view.width) * view.zoom))
  view.dec = Math.max(-limit, Math.min(limit, view.dec))
  view.ra = wrapRa(view.ra)
}

export function wrapRa(ra: number): number {
  return ((ra % 24) + 24) % 24
}

export function raDifference(ra: number, center: number): number {
  return wrapRa(ra - center + 12) - 12
}

/** Chart latitude continues across the poles; a full meridian turn is 360°. */
export function wrapLatitude(latitude: number): number {
  return ((((latitude + 180) % 360) + 360) % 360) - 180
}

export function latitudeDifference(latitude: number, center: number): number {
  return latitude - center
}

/** Converts an extended chart position into physical equatorial coordinates. */
export function normalizeSkyPosition(position: SkyPosition): SkyPosition {
  const latitude = wrapLatitude(position.dec)
  if (latitude > 90) return { ra: wrapRa(position.ra + 12), dec: 180 - latitude }
  if (latitude < -90) return { ra: wrapRa(position.ra + 12), dec: -180 - latitude }
  return { ra: wrapRa(position.ra), dec: latitude }
}

/** Projects the chart, repeating only right ascension horizontally. */
export function projectChartPosition(position: SkyPosition, view: SkyView): ScreenPoint {
  const worldWidth = view.width * view.zoom
  return {
    x: view.width / 2 - (raDifference(position.ra, view.ra) / 24) * worldWidth,
    y: view.height / 2 - ((position.dec - view.dec) / 360) * worldWidth,
  }
}

export function projectPosition(position: SkyPosition, view: SkyView): ScreenPoint {
  return projectChartPosition(position, view)
}

export function unprojectChartPoint(point: ScreenPoint, view: SkyView): SkyPosition {
  const worldWidth = view.width * view.zoom
  return {
    ra: wrapRa(view.ra - ((point.x - view.width / 2) / worldWidth) * 24),
    dec: view.dec - ((point.y - view.height / 2) / worldWidth) * 360,
  }
}

export function unprojectPoint(point: ScreenPoint, view: SkyView): SkyPosition {
  return unprojectChartPoint(point, view)
}

/** Fits a celestial figure using its smallest RA arc and its actual north–south extent. */
export function fitSkyPositions(
  positions: readonly SkyPosition[],
  view: SkyView,
  padding = 48,
): Pick<SkyView, 'ra' | 'dec' | 'zoom'> | null {
  if (positions.length === 0) return null

  const rightAscensions = positions.map((position) => wrapRa(position.ra)).sort((a, b) => a - b)
  let largestGap = 0
  let arcStart = rightAscensions[0] ?? 0
  for (let index = 0; index < rightAscensions.length; index += 1) {
    const current = rightAscensions[index] ?? 0
    const next = rightAscensions[index + 1] ?? (rightAscensions[0] ?? 0) + 24
    const gap = next - current
    if (gap > largestGap) {
      largestGap = gap
      arcStart = next
    }
  }

  let minDec = Infinity
  let maxDec = -Infinity
  for (const position of positions) {
    minDec = Math.min(minDec, position.dec)
    maxDec = Math.max(maxDec, position.dec)
  }

  const width = Math.max(1, view.width)
  const height = Math.max(1, view.height)
  const inset = Math.max(0, padding)
  const availableWidth = Math.max(1, width - 2 * inset)
  const availableHeight = Math.max(1, height - 2 * inset)
  const raSpan = 24 - largestGap
  const decSpan = maxDec - minDec
  const horizontalZoom = raSpan > 0 ? (availableWidth * 24) / (width * raSpan) : MAX_ZOOM
  const verticalZoom = decSpan > 0 ? (availableHeight * 360) / (width * decSpan) : MAX_ZOOM

  return {
    ra: wrapRa(arcStart + raSpan / 2),
    dec: (minDec + maxDec) / 2,
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, horizontalZoom, verticalZoom)),
  }
}

/** Visits horizontal copies only; the chart ends at its north and south poles. */
export function forEachVisibleCopy(
  point: ScreenPoint,
  view: SkyView,
  visitor: (point: ScreenPoint) => void,
  padding = 0,
): void {
  const worldWidth = view.width * view.zoom
  const edgePadding = padding + SCREEN_EDGE_EPSILON
  if (point.y < -edgePadding || point.y > view.height + edgePadding) return
  const firstColumn = Math.ceil((-edgePadding - point.x) / worldWidth)
  const lastColumn = Math.floor((view.width + edgePadding - point.x) / worldWidth)
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    visitor({ x: point.x + column * worldWidth, y: point.y })
  }
}

export function forEachProjectedPosition(
  position: SkyPosition,
  view: SkyView,
  visitor: (point: ScreenPoint) => void,
  padding = 0,
): void {
  forEachVisibleCopy(projectChartPosition(position, view), view, visitor, padding)
}

interface AngularRange {
  minRa: number
  maxRa: number
  minDec: number
  maxDec: number
}

/** Intersects the viewport with the physical declination range. */
function visibleAngularRanges(view: SkyView, padding: number): AngularRange[] {
  const worldWidth = view.width * view.zoom
  const halfRa = ((view.width / 2 + padding) / worldWidth) * 24
  const halfDec = ((view.height / 2 + padding) / worldWidth) * 360
  const minDec = Math.max(-90, view.dec - halfDec)
  const maxDec = Math.min(90, view.dec + halfDec)
  if (minDec > maxDec) return []
  const ra = wrapRa(view.ra)
  return [{ minRa: ra - halfRa, maxRa: ra + halfRa, minDec, maxDec }]
}

function positionIsVisible(position: SkyPosition, view: SkyView, padding = 0): boolean {
  const direct = projectChartPosition(position, view)
  const edgePadding = padding + SCREEN_EDGE_EPSILON
  const inside = (point: ScreenPoint) =>
    point.x >= -edgePadding &&
    point.x <= view.width + edgePadding &&
    point.y >= -edgePadding &&
    point.y <= view.height + edgePadding
  return inside(direct)
}

/** A fixed angular index that visits each catalogue entry only once. */
export class SkyIndex<T extends SkyPosition> {
  private readonly columns = 96
  private readonly rows = 36
  private readonly cells: T[][]
  private readonly poles: { position: T; coordinates: SkyPosition }[] = []
  private readonly cellMarks = new Uint32Array(this.columns * this.rows)
  private readonly fullCellMarks = new Uint32Array(this.columns * this.rows)
  private readonly selectedCells: number[] = []
  private generation = 0

  constructor(positions: readonly T[]) {
    this.cells = Array.from({ length: this.columns * this.rows }, () => [])
    for (const position of positions) {
      if (Math.abs(position.dec) === 90) {
        this.poles.push({ position, coordinates: { ra: wrapRa(position.ra), dec: position.dec } })
        continue
      }
      const column = Math.floor((wrapRa(position.ra) / 24) * this.columns)
      const row = Math.max(
        0,
        Math.min(this.rows - 1, Math.floor(((position.dec + 90) / 180) * this.rows)),
      )
      this.cells[row * this.columns + column]?.push(position)
    }
  }

  query(view: SkyView, padding = 0): T[] {
    const result: T[] = []
    this.forEachInView(view, (position) => result.push(position), padding)
    return result
  }

  private collectCells(view: SkyView, padding: number): void {
    this.generation = (this.generation + 1) >>> 0
    if (this.generation === 0) {
      this.cellMarks.fill(0)
      this.fullCellMarks.fill(0)
      this.generation = 1
    }
    this.selectedCells.length = 0
    const cellWidth = 24 / this.columns
    const cellHeight = 180 / this.rows

    for (const range of visibleAngularRanges(view, padding + SCREEN_EDGE_EPSILON)) {
      const firstRow = Math.max(
        0,
        Math.min(this.rows - 1, Math.floor((range.minDec + 90) / cellHeight)),
      )
      const lastRow = Math.min(this.rows - 1, Math.floor((range.maxDec + 90) / cellHeight))
      const firstColumn = Math.floor(range.minRa / cellWidth)
      const lastColumn = Math.floor(range.maxRa / cellWidth)
      const columnCount = Math.min(this.columns, lastColumn - firstColumn + 1)
      const allRa = range.maxRa - range.minRa >= 24
      const allDec = range.minDec <= -90 && range.maxDec >= 90

      for (let row = firstRow; row <= lastRow; row += 1) {
        const rowMinDec = row * cellHeight - 90
        const rowInside =
          allDec || (rowMinDec > range.minDec && rowMinDec + cellHeight < range.maxDec)
        for (let offset = 0; offset < columnCount; offset += 1) {
          const unwrappedColumn = firstColumn + offset
          const column = ((unwrappedColumn % this.columns) + this.columns) % this.columns
          const cellId = row * this.columns + column
          if (this.cellMarks[cellId] !== this.generation) {
            this.cellMarks[cellId] = this.generation
            this.selectedCells.push(cellId)
          }
          const columnMinRa = unwrappedColumn * cellWidth
          const columnInside =
            allRa || (columnMinRa > range.minRa && columnMinRa + cellWidth < range.maxRa)
          if (rowInside && columnInside) this.fullCellMarks[cellId] = this.generation
        }
      }
    }
  }

  /** Visits candidate cells once; callers can clip each physical image at pixel precision. */
  forEachInView(view: SkyView, visitor: (position: T) => void, padding = 0): void {
    this.collectCells(view, padding)
    for (const cellId of this.selectedCells) {
      const cell = this.cells[cellId]
      if (cell) for (const position of cell) visitor(position)
    }
    for (const pole of this.poles) {
      if (positionIsVisible(pole.coordinates, view, padding)) visitor(pole.position)
    }
  }

  /** Counts each physical star once; fully visible cells use their stored populations. */
  countInView(view: SkyView): number {
    this.collectCells(view, 0)
    let count = 0
    for (const cellId of this.selectedCells) {
      const cell = this.cells[cellId]
      if (!cell?.length) continue
      if (this.fullCellMarks[cellId] === this.generation) {
        count += cell.length
        continue
      }
      for (const position of cell) {
        if (positionIsVisible(position, view)) count += 1
      }
    }
    for (const pole of this.poles) {
      if (positionIsVisible(pole.coordinates, view)) count += 1
    }
    return count
  }
}
