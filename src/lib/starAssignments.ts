export const ASSIGNMENT_SLOTS = [1, 2, 3] as const
export type AssignmentSlot = (typeof ASSIGNMENT_SLOTS)[number]
export type StarAssignments = [number | null, number | null, number | null]

export const ASSIGNMENTS_STORAGE_KEY = 'sideral.star-assignments.v1'

export function emptyStarAssignments(): StarAssignments {
  return [null, null, null]
}

function isStarId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function normalizeAssignments(values: readonly unknown[]): StarAssignments {
  const assignments = emptyStarAssignments()
  const usedIds = new Set<number>()

  for (const slot of ASSIGNMENT_SLOTS) {
    const id = values[slot - 1]
    if (isStarId(id) && !usedIds.has(id)) {
      assignments[slot - 1] = id
      usedIds.add(id)
    }
  }

  return assignments
}

export function parseStarAssignments(raw: string | null): StarAssignments {
  if (raw === null) return emptyStarAssignments()

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length === ASSIGNMENT_SLOTS.length
      ? normalizeAssignments(parsed)
      : emptyStarAssignments()
  } catch {
    return emptyStarAssignments()
  }
}

export function assignStar(
  assignments: StarAssignments,
  slot: AssignmentSlot,
  starId: number,
): StarAssignments {
  const next: StarAssignments = [...assignments]
  if (!isStarId(starId)) return next

  for (const existingSlot of ASSIGNMENT_SLOTS) {
    if (next[existingSlot - 1] === starId) next[existingSlot - 1] = null
  }
  next[slot - 1] = starId
  return next
}

export function clearStarAssignment(
  assignments: StarAssignments,
  slot: AssignmentSlot,
): StarAssignments {
  const next: StarAssignments = [...assignments]
  next[slot - 1] = null
  return next
}

export function reconcileStarAssignments(
  assignments: StarAssignments,
  validIds: ReadonlySet<number>,
): StarAssignments {
  return normalizeAssignments(
    assignments.map((id) => (id !== null && validIds.has(id) ? id : null)),
  )
}
