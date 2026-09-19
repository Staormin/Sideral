<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { mdiStarFourPoints } from '@mdi/js'
import '@fontsource/rajdhani/latin-500.css'
import { ASSIGNMENT_SLOTS } from '../lib/starAssignments'
import { RIDDLES } from '../data/riddles'
import { starName } from '../lib/astronomy'
import type { Star } from '../types/catalog'

defineProps<{ assignments: readonly (Star | null)[] }>()
defineEmits<{ 'return-to-map': [event: MouseEvent] }>()
const page = ref<HTMLElement | null>(null)
const baseUrl = import.meta.env.BASE_URL
onMounted(() => page.value?.focus({ preventScroll: true }))
</script>

<template>
  <main ref="page" class="riddles-page" aria-label="Énigmes" tabindex="-1">
    <div class="riddles-content">
      <article
        v-for="slot in ASSIGNMENT_SLOTS"
        :key="slot"
        class="riddle-section"
        :aria-labelledby="`riddle-${slot}`"
      >
        <div class="riddle-ornament">
          <span aria-hidden="true" />
          <h2 :id="`riddle-${slot}`">Énigme {{ slot }}</h2>
          <span aria-hidden="true" />
        </div>
        <img
          v-if="RIDDLES[slot].image"
          class="riddle-image"
          :src="baseUrl + RIDDLES[slot].image!.src"
          :alt="RIDDLES[slot].image!.alt"
          :width="RIDDLES[slot].image!.width"
          :height="RIDDLES[slot].image!.height"
          decoding="async"
        />
        <div v-if="RIDDLES[slot].paragraphs.length" class="riddle-text">
          <p v-for="(paragraph, index) in RIDDLES[slot].paragraphs" :key="index">{{ paragraph }}</p>
        </div>
        <p v-if="!RIDDLES[slot].paragraphs.length && !RIDDLES[slot].image" class="riddle-pending">
          L’énoncé de cette énigme sera bientôt disponible.
        </p>
        <p v-if="assignments[slot - 1]" class="riddle-assigned">
          Étoile associée · {{ starName(assignments[slot - 1]!) }}
        </p>
        <v-icon class="riddle-seal" :icon="mdiStarFourPoints" size="14" aria-hidden="true" />
      </article>
      <a class="return-to-map" href="#carte" @click="$emit('return-to-map', $event)">
        Revenir à la carte
      </a>
    </div>
  </main>
</template>

<style scoped>
.riddles-page {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background:
    radial-gradient(ellipse at 85% 10%, #4976971c, transparent 55%),
    radial-gradient(ellipse at 15% 90%, #ae844512, transparent 55%), #0b121d;
  scrollbar-color: #b3936066 transparent;
}

.riddles-content {
  width: min(100%, 900px);
  margin-inline: auto;
  padding: clamp(32px, 6vw, 72px) clamp(24px, 5vw, 64px);
}

.riddles-page:focus {
  outline: none;
}

.riddle-section {
  padding-block: clamp(36px, 6vw, 64px);
  text-align: center;
}

.riddle-section + .riddle-section {
  border-top: 1px solid #d7bc8c1f;
}

.riddle-ornament {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-bottom: 32px;
  color: #d7bc8c;
}

.riddle-ornament h2 {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.riddle-ornament span {
  width: 64px;
  height: 1px;
  background: linear-gradient(90deg, transparent, #d7bc8c66);
}

.riddle-ornament span:last-child {
  transform: rotate(180deg);
}

.riddle-text {
  max-width: 38rem;
  margin-inline: auto;
  color: #e9decb;
  font-family: Rajdhani, sans-serif;
  font-size: clamp(19px, 2.6vw, 23px);
  font-weight: 500;
  line-height: 2.3;
  letter-spacing: 0.025em;
  text-align: justify;
  text-align-last: center;
  text-shadow: 0 0 24px #d7bc8c18;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.riddle-text p + p {
  margin-top: 24px;
}

.riddle-pending {
  color: #9ba9bc;
  font-size: 14px;
  line-height: 1.8;
}

.riddle-image {
  display: block;
  width: min(100%, 38rem);
  height: auto;
  margin-inline: auto;
}

.riddle-image + .riddle-text {
  margin-top: 32px;
}

.riddle-assigned {
  margin-top: 24px;
  color: #b6a991;
  font-size: 12px;
}

.riddle-seal {
  margin-top: 32px;
  color: #d7bc8c;
}

.return-to-map {
  display: block;
  width: fit-content;
  margin: 24px auto 0;
  padding: 12px 20px;
  color: #d7bc8c;
  font-size: 13px;
  text-underline-offset: 6px;
}

.return-to-map:focus-visible {
  outline: 2px solid #d7bc8c;
  outline-offset: 3px;
}
</style>
