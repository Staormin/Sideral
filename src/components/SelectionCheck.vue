<script setup lang="ts">
import type { SelectionCheckStatus } from '../composables/useSelectionCheck'

defineProps<{ status: SelectionCheckStatus }>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <span v-if="status === 'checking'" class="selection-checking" role="status" aria-live="polite">
    Tracé en cours…
  </span>
  <div v-else-if="status === 'error'" class="map-state selection-error" role="status">
    <p>Une erreur est survenue.</p>
    <v-btn color="primary" variant="tonal" @click="emit('retry')">Réessayer</v-btn>
  </div>
</template>

<style scoped>
.selection-error {
  z-index: 3;
}

.selection-checking {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
  pointer-events: none;
}
</style>
