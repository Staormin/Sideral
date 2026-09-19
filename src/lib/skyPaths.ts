import {
  forEachVisibleCopy,
  projectChartPosition,
  type ScreenPoint,
  type SkyPosition,
  type SkyView,
} from './skyProjection'

type SegmentVisitor = (
  start: ScreenPoint,
  end: ScreenPoint,
  pathIndex: number,
  segmentIndex: number,
) => void

function forEachProjectedSegment(
  paths: readonly (readonly SkyPosition[])[],
  view: SkyView,
  visitor: SegmentVisitor,
): void {
  const worldWidth = view.width * view.zoom
  for (const [pathIndex, path] of paths.entries()) {
    for (let index = 1; index < path.length; index += 1) {
      const previous = path[index - 1]
      const next = path[index]
      if (!previous || !next) continue
      const start = projectChartPosition(previous, view)
      const dx = (-(next.ra - previous.ra) / 24) * worldWidth
      const dy = (-(next.dec - previous.dec) / 360) * worldWidth
      const middle = { x: start.x + dx / 2, y: start.y + dy / 2 }
      forEachVisibleCopy(
        middle,
        view,
        (point) => {
          visitor(
            { x: point.x - dx / 2, y: point.y - dy / 2 },
            { x: point.x + dx / 2, y: point.y + dy / 2 },
            pathIndex,
            index,
          )
        },
        Math.max(Math.abs(dx), Math.abs(dy)) / 2,
      )
    }
  }
}

/** Traces separate celestial runs with unwrapped RA, including their horizontal chart copies. */
export function traceSkyPaths(
  ctx: CanvasRenderingContext2D,
  paths: readonly (readonly SkyPosition[])[],
  view: SkyView,
): void {
  forEachProjectedSegment(paths, view, (start, end) => {
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
  })
}

interface ProjectedRun {
  end: ScreenPoint
  commands: string[]
}

interface RunGroup {
  segmentIndex: number
  previous: ProjectedRun[]
  current: ProjectedRun[]
}

/** SVG counterparts of the canvas paths, joined only within continuous visible chart copies. */
export function projectSkyPaths(
  paths: readonly (readonly SkyPosition[])[],
  view: SkyView,
): string[] {
  const runs: ProjectedRun[] = []
  const groups = new Map<number, RunGroup>()
  forEachProjectedSegment(paths, view, (start, end, pathIndex, segmentIndex) => {
    const groupKey = pathIndex
    let group = groups.get(groupKey)
    if (!group) {
      group = { segmentIndex, previous: [], current: [] }
      groups.set(groupKey, group)
    } else if (group.segmentIndex !== segmentIndex) {
      group.previous = group.segmentIndex === segmentIndex - 1 ? group.current : []
      group.current = []
      group.segmentIndex = segmentIndex
    }

    // Projection can wrap an adjacent vertex by a whole chart turn; match its actual screen copy.
    const previousIndex = group.previous.findIndex(
      (candidate) =>
        Math.abs(candidate.end.x - start.x) < 1e-7 && Math.abs(candidate.end.y - start.y) < 1e-7,
    )
    let run = previousIndex < 0 ? undefined : group.previous.splice(previousIndex, 1)[0]
    if (!run) {
      run = { end, commands: [`M ${start.x} ${start.y}`] }
      runs.push(run)
    }
    run.commands.push(`L ${end.x} ${end.y}`)
    run.end = end
    group.current.push(run)
  })
  return runs.map((run) => run.commands.join(' '))
}
