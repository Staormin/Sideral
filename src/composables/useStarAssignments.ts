import { computed, ref, shallowRef, type ShallowRef } from 'vue'
import {
  ASSIGNMENTS_STORAGE_KEY,
  assignStar,
  clearStarAssignment,
  emptyStarAssignments,
  parseStarAssignments,
  reconcileStarAssignments,
  type AssignmentSlot,
  type StarAssignments,
} from '../lib/starAssignments'
import type { Star } from '../types/catalog'

export function useStarAssignments(stars: ShallowRef<Star[]>) {
  const ids = shallowRef<StarAssignments>(emptyStarAssignments())
  const storageAvailable = ref(true)
  let restored = false
  const assignments = computed(() =>
    ids.value.map((id) =>
      id === null ? null : (stars.value.find((star) => star.id === id) ?? null),
    ),
  )

  function save(): void {
    try {
      localStorage.setItem(ASSIGNMENTS_STORAGE_KEY, JSON.stringify(ids.value))
      storageAvailable.value = true
    } catch {
      storageAvailable.value = false
    }
  }

  function restore(): void {
    if (!restored) {
      try {
        ids.value = parseStarAssignments(localStorage.getItem(ASSIGNMENTS_STORAGE_KEY))
      } catch {
        storageAvailable.value = false
      }
      restored = true
    }
    const reconciled = reconcileStarAssignments(ids.value, new Set(stars.value.map(({ id }) => id)))
    if (reconciled.some((id, index) => id !== ids.value[index])) {
      ids.value = reconciled
      save()
    }
  }

  function change(next: StarAssignments): void {
    if (next.every((id, index) => id === ids.value[index])) return
    ids.value = next
    save()
  }

  function assign(slot: AssignmentSlot, star: Star): void {
    change(assignStar(ids.value, slot, star.id))
  }

  function unassign(slot: AssignmentSlot): void {
    change(clearStarAssignment(ids.value, slot))
  }

  return { assignments, storageAvailable, restore, assign, unassign }
}
