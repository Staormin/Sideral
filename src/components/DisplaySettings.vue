<script setup lang="ts">
import { ref } from 'vue'
import { mdiTuneVariant } from '@mdi/js'

const showConstellations = defineModel<boolean>('constellations', { required: true })
const showGrid = defineModel<boolean>('grid', { required: true })
const showLabels = defineModel<boolean>('labels', { required: true })
const open = ref(false)
</script>

<template>
  <v-menu
    v-model="open"
    location="top end"
    :offset="10"
    :close-on-content-click="false"
    :activator-props="{ 'aria-haspopup': undefined }"
    :content-props="{ role: 'region', 'aria-label': 'Affichage' }"
    transition="slide-y-reverse-transition"
  >
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        class="display-settings-button"
        :class="{ 'is-active': open }"
        :icon="mdiTuneVariant"
        variant="plain"
        :ripple="false"
        width="44"
        height="44"
        aria-label="Réglages d’affichage"
        title="Réglages d’affichage"
      />
    </template>
    <v-card class="display-settings-panel" width="280" max-width="calc(100vw - 24px)">
      <h2>Affichage</h2>
      <div class="layer-row">
        <span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 17 5-12 6 14 5-10M4 17l11 2" />
            <circle cx="4" cy="17" r="1.6" />
            <circle cx="9" cy="5" r="1.6" />
            <circle cx="15" cy="19" r="1.6" />
            <circle cx="20" cy="9" r="1.6" />
          </svg>
          Constellations
        </span>
        <v-switch
          v-model="showConstellations"
          aria-label="Afficher les constellations"
          color="primary"
          hide-details
          inset
          density="compact"
        />
      </div>
      <div class="layer-row">
        <span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />
          </svg>
          Grille équatoriale
        </span>
        <v-switch
          v-model="showGrid"
          aria-label="Afficher la grille équatoriale"
          color="primary"
          hide-details
          inset
          density="compact"
        />
      </div>
      <div class="layer-row">
        <span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16M12 5v15M8 20h8" />
          </svg>
          Noms des étoiles
        </span>
        <v-switch
          v-model="showLabels"
          aria-label="Afficher les noms des étoiles"
          color="primary"
          hide-details
          inset
          density="compact"
        />
      </div>
    </v-card>
  </v-menu>
</template>

<style scoped>
.display-settings-button.v-btn {
  flex-shrink: 0;
  margin-left: auto;
  color: #a8b6c9;
  background: transparent;
  border: 0;
  outline: none;
  box-shadow: none;
  opacity: 1;
}

.display-settings-button::after {
  border: 0;
}

.display-settings-button :deep(.v-icon) {
  font-size: 20px;
  transition:
    color 160ms,
    transform 160ms;
}

.display-settings-button:is(:hover, :focus-visible, .is-active) :deep(.v-icon) {
  color: #deb478;
  transform: scale(1.1);
}

.display-settings-panel.v-card {
  padding: 17px 18px 12px;
  color: #e9eaf0;
  background: #111b28f5;
  border: 1px solid #7388a333;
  box-shadow: 0 14px 45px #0006;
  backdrop-filter: blur(16px);
}

.display-settings-panel h2 {
  margin: 0 0 8px;
  color: #a7b3c5;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
</style>
