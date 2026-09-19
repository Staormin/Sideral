<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, type CSSProperties } from 'vue'

interface ScintillationPoint {
  key: string
  x: number
  y: number
  color: string
  radius: number
  phase: number
}

const props = defineProps<{ points: readonly ScintillationPoint[]; intense?: boolean }>()

const paused = ref(false)

function pointStyle(point: ScintillationPoint): CSSProperties {
  return {
    transform: `translate3d(${point.x}px, ${point.y}px, 0)`,
    '--star-color': point.color,
    '--glow-size': `${props.intense ? 300 : Math.min(84, Math.max(48, point.radius * 7 + 36))}px`,
    '--core-size': `${props.intense ? 14 : Math.min(5.4, Math.max(2.6, point.radius * 0.92))}px`,
    '--halo-duration': `${4.6 + point.phase * 2.1}s`,
    '--rays-duration': `${3.1 + point.phase * 1.7}s`,
    '--core-duration': `${2.3 + point.phase * 1.3}s`,
    '--twinkle-delay': `${-point.phase * 9.7}s`,
  }
}

function updateVisibility(): void {
  paused.value = document.hidden
}

onMounted(() => {
  updateVisibility()
  document.addEventListener('visibilitychange', updateVisibility)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', updateVisibility)
})
</script>

<template>
  <div
    class="star-scintillation"
    :class="{ 'is-paused': paused, 'is-intense': intense }"
    aria-hidden="true"
  >
    <div
      v-for="point in points"
      :key="point.key"
      class="star-scintillation__point"
      :style="pointStyle(point)"
    >
      <span class="star-scintillation__halo"></span>
      <span class="star-scintillation__rays"></span>
      <span class="star-scintillation__core"></span>
    </div>
  </div>
</template>

<style scoped>
.star-scintillation {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;
}

.star-scintillation__point {
  position: absolute;
  top: calc(var(--glow-size) / -2);
  left: calc(var(--glow-size) / -2);
  width: var(--glow-size);
  height: var(--glow-size);
  contain: layout style paint;
  mix-blend-mode: screen;
}

.star-scintillation__halo {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--star-color) 35%, white) 0%,
    color-mix(in srgb, var(--star-color) 92%, transparent) 4%,
    color-mix(in srgb, var(--star-color) 46%, transparent) 12%,
    color-mix(in srgb, var(--star-color) 18%, transparent) 29%,
    color-mix(in srgb, var(--star-color) 5%, transparent) 49%,
    transparent 70%
  );
  opacity: 0.72;
  animation: stellar-halo var(--halo-duration) ease-in-out var(--twinkle-delay) infinite;
}

.star-scintillation__rays {
  position: absolute;
  inset: 0;
  opacity: 0.66;
  transform: rotate(-14deg) scale(0.84);
  animation: stellar-rays var(--rays-duration) ease-in-out var(--twinkle-delay) infinite;
}

.star-scintillation__rays::before,
.star-scintillation__rays::after {
  position: absolute;
  top: 50%;
  left: 50%;
  height: 1px;
  content: '';
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--star-color) 35%, transparent) 20%,
    var(--star-color) 42%,
    #fff 50%,
    var(--star-color) 58%,
    color-mix(in srgb, var(--star-color) 35%, transparent) 80%,
    transparent
  );
}

.star-scintillation__rays::before {
  width: 90%;
  transform: translate(-50%, -50%);
}

.star-scintillation__rays::after {
  width: 64%;
  transform: translate(-50%, -50%) rotate(90deg);
}

.star-scintillation__core {
  position: absolute;
  top: calc(50% - var(--core-size) / 2);
  left: calc(50% - var(--core-size) / 2);
  width: var(--core-size);
  height: var(--core-size);
  background: radial-gradient(circle, #fff 20%, var(--star-color) 76%, transparent 100%);
  border-radius: 50%;
  box-shadow:
    0 0 5px color-mix(in srgb, var(--star-color) 86%, transparent),
    0 0 11px color-mix(in srgb, var(--star-color) 45%, transparent);
  opacity: 0.95;
  animation: stellar-core var(--core-duration) ease-in-out var(--twinkle-delay) infinite;
}

.is-intense .star-scintillation__halo {
  background: radial-gradient(
    circle,
    #fff 0%,
    color-mix(in srgb, var(--star-color) 25%, white) 3%,
    color-mix(in srgb, var(--star-color) 85%, transparent) 9%,
    color-mix(in srgb, var(--star-color) 48%, transparent) 23%,
    color-mix(in srgb, var(--star-color) 16%, transparent) 45%,
    transparent 70%
  );
  animation: intense-glow 2.4s ease-in-out infinite;
}

.is-intense .star-scintillation__rays {
  opacity: 1;
  animation: none;
  transform: rotate(-14deg);
}

.is-intense .star-scintillation__core {
  background: #fff;
  box-shadow:
    0 0 14px 5px #fff,
    0 0 42px 12px var(--star-color);
  animation: none;
}

@keyframes intense-glow {
  0%,
  100% {
    opacity: 0.85;
    transform: scale(0.95);
  }

  50% {
    opacity: 1;
    transform: scale(1.06);
  }
}

.star-scintillation.is-paused .star-scintillation__halo,
.star-scintillation.is-paused .star-scintillation__rays,
.star-scintillation.is-paused .star-scintillation__core {
  animation-play-state: paused;
}

@keyframes stellar-halo {
  0%,
  100% {
    opacity: 0.56;
    transform: scale(0.86);
  }

  43% {
    opacity: 0.88;
    transform: scale(1.04);
  }

  72% {
    opacity: 0.64;
    transform: scale(0.94);
  }
}

@keyframes stellar-rays {
  0%,
  100% {
    opacity: 0.4;
    transform: rotate(-14deg) scale(0.68);
  }

  37% {
    opacity: 0.86;
    transform: rotate(-14deg) scale(1);
  }

  68% {
    opacity: 0.55;
    transform: rotate(-14deg) scale(0.81);
  }
}

@keyframes stellar-core {
  0%,
  100% {
    opacity: 0.84;
    transform: scale(0.94);
  }

  32% {
    opacity: 1;
    transform: scale(1.09);
  }

  67% {
    opacity: 0.9;
    transform: scale(0.98);
  }
}

@media (prefers-reduced-motion: reduce) {
  .is-intense .star-scintillation__halo,
  .star-scintillation__halo,
  .star-scintillation__rays,
  .star-scintillation__core {
    animation: none;
  }
}
</style>
