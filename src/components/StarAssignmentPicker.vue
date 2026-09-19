<script setup lang="ts">
import { computed } from 'vue'
import { mdiCheck, mdiPlus, mdiSwapHorizontal } from '@mdi/js'
import { starName } from '../lib/astronomy'
import { ASSIGNMENT_SLOTS, type AssignmentSlot } from '../lib/starAssignments'
import type { Star } from '../types/catalog'

const props = defineProps<{ star: Star; assignments: readonly (Star | null)[] }>()
const emit = defineEmits<{
  assign: [slot: AssignmentSlot]
  unassign: [slot: AssignmentSlot]
}>()

const choices = computed(() =>
  ASSIGNMENT_SLOTS.map((slot) => {
    const assigned = props.assignments[slot - 1]
    const selected = assigned?.id === props.star.id
    const name = starName(props.star)

    return {
      slot,
      selected,
      occupied: !!assigned,
      name: assigned ? starName(assigned) : 'À choisir',
      action: selected ? 'Retirer' : assigned ? 'Remplacer' : 'Associer',
      icon: selected ? mdiCheck : assigned ? mdiSwapHorizontal : mdiPlus,
      label: selected
        ? `Retirer ${name} de l’énigme ${slot}`
        : assigned
          ? `Remplacer ${starName(assigned)} par ${name} pour l’énigme ${slot}`
          : `Associer ${name} à l’énigme ${slot}`,
    }
  }),
)
</script>

<template>
  <section class="assignment-picker" aria-labelledby="assignment-picker-title">
    <div class="assignment-picker-heading">
      <h3 id="assignment-picker-title">Associer à une énigme</h3>
      <p>Vos choix restent modifiables.</p>
    </div>
    <div class="assignment-options">
      <button
        v-for="choice in choices"
        :key="choice.slot"
        type="button"
        class="assignment-option"
        :class="{
          'is-selected': choice.selected,
          'is-occupied': choice.occupied,
        }"
        :aria-label="choice.label"
        :aria-pressed="choice.selected"
        :title="choice.label"
        @click="choice.selected ? emit('unassign', choice.slot) : emit('assign', choice.slot)"
      >
        <span class="assignment-option-heading">
          <span>Énigme {{ choice.slot }}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path :d="choice.icon" /></svg>
        </span>
        <span class="assignment-option-name">{{ choice.name }}</span>
        <span class="assignment-option-action">{{ choice.action }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.assignment-picker {
  min-width: 0;
}

.assignment-picker-heading {
  margin-bottom: 13px;
}

.assignment-picker .assignment-picker-heading h3 {
  margin: 0;
  color: #ece7df;
  font-size: 13px;
  font-weight: 600;
}

.assignment-picker-heading p {
  margin-top: 4px;
  color: #9ba9bb;
  font-size: 11px;
  line-height: 1.5;
}

.assignment-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.assignment-option {
  display: flex;
  min-width: 0;
  min-height: 104px;
  flex-direction: column;
  align-items: stretch;
  padding: 13px;
  border: 1px solid #556477;
  border-radius: 11px;
  background: #162130;
  color: #c8d0dc;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background-color 160ms ease;
}

.assignment-option-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 3px;
  color: #d3ba94;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.assignment-option-heading svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  fill: currentcolor;
}

.assignment-option-name {
  overflow: hidden;
  margin-top: 10px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assignment-option-action {
  margin-top: 4px;
  color: #a6b3c6;
  font-size: 10px;
  line-height: 1.5;
}

.assignment-option.is-occupied {
  background: #1c2533;
}

.assignment-option.is-selected {
  border-color: #d9b579;
  background: #d9b57915;
}

.assignment-option.is-selected .assignment-option-heading,
.assignment-option.is-selected .assignment-option-name {
  color: #f0d5ac;
}

.assignment-option:focus-visible {
  outline: 2px solid #f0d5ac;
  outline-offset: 3px;
}

@media (hover: hover) {
  .assignment-option:hover {
    border-color: #d9b579;
    background: #d9b57912;
  }
}

@media (width <= 420px) {
  .assignment-options {
    gap: 6px;
  }

  .assignment-option {
    min-height: 96px;
    padding: 10px 7px;
    border-radius: 9px;
  }

  .assignment-option-heading {
    position: relative;
    font-size: 9px;
  }

  .assignment-option-heading svg {
    width: 13px;
    height: 13px;
  }

  .assignment-option-name {
    margin-top: 9px;
    font-size: 11px;
  }

  .assignment-option-action {
    font-size: 9px;
  }
}
</style>
