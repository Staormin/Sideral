import { describe, expect, it } from 'vitest'
import {
  ASSIGNMENT_SLOTS,
  assignStar,
  clearStarAssignment,
  emptyStarAssignments,
  parseStarAssignments,
  reconcileStarAssignments,
  type StarAssignments,
} from './starAssignments'

const firstId = 2_000_001
const secondId = 2_000_002
const thirdId = 2_000_003
const fourthId = 2_000_004

describe('personal star assignments', () => {
  it('starts with three independent empty slots', () => {
    const assignments = emptyStarAssignments()
    assignments[0] = firstId
    expect(emptyStarAssignments()).toEqual([null, null, null])
    expect(ASSIGNMENT_SLOTS).toEqual([1, 2, 3])
  })

  it.each([null, '', '{', 'null', '{}', 'true', '12', '[]', '[1,2]', '[1,2,3,4]'])(
    'ignores unsupported stored data: %s',
    (raw) => {
      expect(parseStarAssignments(raw)).toEqual([null, null, null])
    },
  )

  it('restores a tuple without changing slot order', () => {
    const assignments: StarAssignments = [null, secondId, firstId]
    expect(parseStarAssignments(JSON.stringify(assignments))).toEqual(assignments)
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2000001', {}, [], true])(
    'clears an invalid ID while preserving other slots: %j',
    (invalidId) => {
      expect(parseStarAssignments(JSON.stringify([firstId, invalidId, thirdId]))).toEqual([
        firstId,
        null,
        thirdId,
      ])
    },
  )

  it('keeps only the first occurrence of each restored ID', () => {
    expect(parseStarAssignments(JSON.stringify([firstId, firstId, firstId]))).toEqual([
      firstId,
      null,
      null,
    ])
    expect(parseStarAssignments(JSON.stringify([null, secondId, secondId]))).toEqual([
      null,
      secondId,
      null,
    ])
  })

  it('assigns or replaces only the requested slot without mutating the input', () => {
    const original: StarAssignments = [firstId, secondId, null]
    expect(assignStar(original, 3, thirdId)).toEqual([firstId, secondId, thirdId])
    expect(assignStar(original, 2, fourthId)).toEqual([firstId, fourthId, null])
    expect(original).toEqual([firstId, secondId, null])
  })

  it('moves an existing assignment into an occupied slot without leaving duplicates', () => {
    const original: StarAssignments = [firstId, secondId, thirdId]
    expect(assignStar(original, 3, firstId)).toEqual([null, secondId, firstId])
    expect(original).toEqual([firstId, secondId, thirdId])
  })

  it('preserves an assignment when assigning the same star to the same slot', () => {
    const original: StarAssignments = [firstId, null, thirdId]
    expect(assignStar(original, 3, thirdId)).toEqual(original)
  })

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid new ID: %s',
    (invalidId) => {
      const original: StarAssignments = [firstId, secondId, thirdId]
      expect(assignStar(original, 2, invalidId)).toEqual(original)
    },
  )

  it('removes only the requested assignment without mutating the input', () => {
    const original: StarAssignments = [firstId, secondId, thirdId]
    expect(clearStarAssignment(original, 2)).toEqual([firstId, null, thirdId])
    expect(original).toEqual([firstId, secondId, thirdId])
  })

  it('keeps only IDs still present in the loaded catalogue', () => {
    const original: StarAssignments = [firstId, secondId, thirdId]
    expect(reconcileStarAssignments(original, new Set([firstId, thirdId, fourthId]))).toEqual([
      firstId,
      null,
      thirdId,
    ])
    expect(reconcileStarAssignments(original, new Set())).toEqual([null, null, null])
    expect(original).toEqual([firstId, secondId, thirdId])
  })

  it('preserves valid empty slots when restoring against a catalogue', () => {
    const restored = parseStarAssignments(JSON.stringify([null, secondId, firstId]))
    expect(reconcileStarAssignments(restored, new Set([firstId, secondId]))).toEqual([
      null,
      secondId,
      firstId,
    ])
  })
})
