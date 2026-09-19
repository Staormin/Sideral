<script setup lang="ts">
import { computed } from 'vue'
import { mdiClose } from '@mdi/js'
import { starColor, starName } from '../lib/astronomy'
import { ASSIGNMENT_SLOTS, type AssignmentSlot } from '../lib/starAssignments'
import type { Star } from '../types/catalog'

const props = defineProps<{
  assignments: readonly (Star | null)[]
  storageAvailable: boolean
  loading: boolean
}>()
const emit = defineEmits<{
  unassign: [slot: AssignmentSlot]
}>()
const entries = computed(() =>
  ASSIGNMENT_SLOTS.map((slot) => ({ slot, star: props.assignments[slot - 1] ?? null })),
)
</script>

<template>
  <section class="panel-section assignments-panel" aria-label="Mes étoiles">
    <ol class="assignment-list">
      <li
        v-for="{ slot, star } in entries"
        :key="slot"
        class="assignment-entry"
        :class="{ 'is-filled': star }"
      >
        <div class="assignment-summary" :class="{ 'assignment-empty': !star }">
          <span
            class="slot-number"
            :style="star ? { '--assigned-color': starColor(star) } : undefined"
          >
            {{ slot }}
          </span>
          <span class="assignment-copy">
            <small>Énigme {{ slot }}</small>
            <strong v-if="star" :title="starName(star)">{{ starName(star) }}</strong>
            <span v-else>{{ loading ? 'Chargement…' : 'Aucune étoile' }}</span>
          </span>
        </div>
        <button
          v-if="star"
          type="button"
          class="assignment-remove"
          :aria-label="`Retirer ${starName(star)} de l’énigme ${slot}`"
          @click="emit('unassign', slot)"
        >
          <v-icon :icon="mdiClose" size="15" aria-hidden="true" />
        </button>
      </li>
    </ol>
    <p v-if="!storageAvailable" class="assignments-storage" role="status">
      Sauvegarde indisponible : vos choix restent dans cette session.
    </p>
  </section>
</template>

<style scoped>
.assignment-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.assignment-entry {
  display: flex;
  min-width: 0;
  border: 1px dashed #8996ac32;
  border-radius: 10px;
  background: #0a111a50;
  transition:
    border-color 160ms,
    background 160ms;
}

.assignment-entry.is-filled {
  border-style: solid;
  border-color: #deb4783d;
  background: linear-gradient(110deg, #deb4780c, #0b121c70);
}

.assignment-summary,
.assignment-empty {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  min-height: 64px;
  padding: 10px;
  gap: 10px;
  text-align: left;
  border-radius: 9px;
}

.assignment-remove:focus-visible {
  outline: 2px solid #dec08d;
  outline-offset: 2px;
}

.slot-number {
  display: grid;
  place-items: center;
  flex: 0 0 29px;
  width: 29px;
  height: 32px;
  border: 1px solid #8b98ad24;
  border-radius: 7px;
  color: #758399;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
}

.is-filled .slot-number {
  color: var(--assigned-color);
  border-color: color-mix(in srgb, var(--assigned-color), transparent 72%);
  background: color-mix(in srgb, var(--assigned-color), transparent 94%);
}

.assignment-copy {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 4px;
  min-width: 0;
}

.assignment-copy small {
  color: #9ca8b8;
  font-size: 9px;
}

.assignment-copy strong,
.assignment-copy > span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
}

.assignment-copy strong {
  font-weight: 600;
  color: #eee3d3;
}

.assignment-empty {
  color: #718096;
}

.assignment-remove {
  align-self: center;
  flex: 0 0 44px;
  width: 44px;
  min-height: 44px;
  border-left: 1px solid #a8b5c512;
  border-radius: 7px;
  color: #8492a5;
}

.assignment-remove:hover {
  color: #efe1d2;
  background: #ffffff06;
}

.assignments-storage {
  margin-top: 12px;
  color: #8290a3;
  font-size: 9px;
  line-height: 1.7;
}
</style>
