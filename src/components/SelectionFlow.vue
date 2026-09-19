<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ paths: readonly string[] }>()

const paused = ref(false)

function updateVisibility(): void {
  paused.value = document.hidden
}

onMounted(() => {
  updateVisibility()
  document.addEventListener('visibilitychange', updateVisibility)
})

onBeforeUnmount(() => document.removeEventListener('visibilitychange', updateVisibility))
</script>

<template>
  <svg
    class="selection-flow"
    :class="{ 'is-paused': paused }"
    width="100%"
    height="100%"
    aria-hidden="true"
    focusable="false"
  >
    <g v-for="(path, index) in paths" :key="index">
      <path :d="path" class="selection-flow__glow" />
      <path :d="path" class="selection-flow__trail" />
      <path :d="path" class="selection-flow__crest" />
      <path :d="path" class="selection-flow__head" />
    </g>
  </svg>
</template>

<style scoped>
.selection-flow {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;
  contain: layout style paint;
}

.selection-flow path {
  --flow-offset: 0px;

  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 64 256;
  animation: selection-current 0.5s linear infinite;
}

.selection-flow__glow {
  stroke: rgb(243 204 143 / 12%);
  stroke-width: 8px;
}

.selection-flow__trail {
  stroke: rgb(239 199 131 / 65%);
  stroke-width: 1.8px;
}

.selection-flow .selection-flow__crest {
  --flow-offset: -36px;

  stroke: #ffe0aa;
  stroke-width: 1.8px;
  stroke-dasharray: 28 292;
}

.selection-flow .selection-flow__head {
  --flow-offset: -61px;

  stroke: #fff9eb;
  stroke-width: 2.8px;
  stroke-dasharray: 3 317;
}

.selection-flow.is-paused path {
  animation-play-state: paused;
}

@keyframes selection-current {
  from {
    stroke-dashoffset: var(--flow-offset);
  }

  to {
    stroke-dashoffset: calc(var(--flow-offset) - 320px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .selection-flow path {
    stroke-dasharray: none;
    animation: none;
  }

  .selection-flow__crest,
  .selection-flow__head {
    opacity: 0;
  }
}
</style>
