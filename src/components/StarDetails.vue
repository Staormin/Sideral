<script setup lang="ts">
import { computed } from 'vue'
import { mdiArrowTopRight, mdiClose, mdiCrosshairsGps } from '@mdi/js'
import StarAssignmentPicker from './StarAssignmentPicker.vue'
import type { Star } from '../types/catalog'
import type { AssignmentSlot } from '../lib/starAssignments'
import {
  starColor,
  starName,
  formatRa,
  formatDec,
  distanceLy,
  estimateTemperature,
  colorSource,
} from '../lib/astronomy'

const props = withDefaults(
  defineProps<{ star: Star | null; assignments: readonly (Star | null)[]; editable?: boolean }>(),
  { editable: true },
)
const emit = defineEmits<{
  close: []
  locate: [star: Star]
  assign: [slot: AssignmentSlot, star: Star]
  unassign: [slot: AssignmentSlot]
}>()
const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })
const fmt = (value: number | null | undefined, unit = '') =>
  value == null ? 'Non renseigné' : `${number.format(value)}${unit ? ` ${unit}` : ''}`
const distance = computed(() => (props.star ? distanceLy(props.star) : null))
const temperature = computed(() => (props.star ? estimateTemperature(props.star) : null))
const identifiers = computed(() =>
  props.star
    ? [
        props.star.hip && `HIP ${props.star.hip}`,
        props.star.hd && `HD ${props.star.hd}`,
        props.star.hr && `HR ${props.star.hr}`,
        props.star.gl,
        props.star.bf,
        `HYG ${props.star.id}`,
      ].filter(Boolean)
    : [],
)
const simbadUrl = computed(
  () =>
    `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(props.star?.hip ? `HIP ${props.star.hip}` : props.star?.hd ? `HD ${props.star.hd}` : props.star ? starName(props.star) : '')}`,
)
</script>

<template>
  <v-dialog
    :model-value="!!star"
    max-width="720"
    scrollable
    aria-labelledby="star-title"
    @update:model-value="!$event && emit('close')"
  >
    <v-card v-if="star" class="star-dialog">
      <v-btn
        :icon="mdiClose"
        aria-label="Fermer la fiche"
        variant="text"
        class="dialog-close"
        @click="emit('close')"
      />
      <div class="star-hero">
        <div class="star-portrait" :style="{ '--star-color': starColor(star) }"><span /></div>
        <div class="star-hero-description">
          <span class="eyebrow">FICHE STELLAIRE · {{ star.con || 'HYG' }}</span>
          <h2 id="star-title">{{ starName(star) }}</h2>
          <p>
            {{ star.spect || 'Type spectral non renseigné' }}
            <span class="muted">· Coordonnées J2000</span>
          </p>
        </div>
      </div>
      <v-card-text class="star-content">
        <div v-if="editable" class="assignment-section">
          <StarAssignmentPicker
            :star="star"
            :assignments="assignments"
            @assign="emit('assign', $event, star)"
            @unassign="emit('unassign', $event)"
          />
          <slot name="storage-notice" />
        </div>
        <div class="star-metrics">
          <div>
            <span>Magnitude apparente</span><strong>{{ fmt(star.mag) }}</strong
            ><small>Éclat vu depuis la Terre</small>
          </div>
          <div>
            <span>Distance</span
            ><strong
              >{{ distance == null ? '—' : number.format(distance) }}
              <em v-if="distance != null">a.l.</em></strong
            ><small>{{
              distance == null ? 'Distance inconnue ou incertaine' : `${fmt(star.dist)} parsecs`
            }}</small>
          </div>
          <div>
            <span>Type spectral</span><strong>{{ star.spect || '—' }}</strong
            ><small>{{
              star.con ? `Constellation : ${star.con}` : 'Constellation non renseignée'
            }}</small>
          </div>
        </div>
        <h3>Position dans le ciel</h3>
        <dl class="data-grid">
          <div>
            <dt>Ascension droite</dt>
            <dd>{{ formatRa(star.ra) }}</dd>
          </div>
          <div>
            <dt>Déclinaison</dt>
            <dd>{{ formatDec(star.dec) }}</dd>
          </div>
          <div>
            <dt>Mouvement propre en AD</dt>
            <dd>{{ fmt(star.pmra, 'mas/an') }}</dd>
          </div>
          <div>
            <dt>Mouvement propre en déclinaison</dt>
            <dd>{{ fmt(star.pmdec, 'mas/an') }}</dd>
          </div>
        </dl>
        <h3>Lumière & propriétés</h3>
        <dl class="data-grid">
          <div>
            <dt>Indice de couleur B−V</dt>
            <dd>
              <i class="color-swatch" :style="{ background: starColor(star) }" />{{ fmt(star.ci) }}
            </dd>
          </div>
          <div>
            <dt>Température estimée par B−V</dt>
            <dd>{{ fmt(temperature, 'K') }}</dd>
          </div>
          <div>
            <dt>Magnitude absolue</dt>
            <dd>{{ fmt(distance == null ? null : star.absmag) }}</dd>
          </div>
          <div>
            <dt>Luminosité</dt>
            <dd>{{ fmt(distance == null ? null : star.lum, 'L☉') }}</dd>
          </div>
          <div>
            <dt>Vitesse radiale</dt>
            <dd>{{ star.rv === 0 ? '0 ou non renseigné' : fmt(star.rv, 'km/s') }}</dd>
          </div>
          <div>
            <dt>Diamètre angulaire mesuré</dt>
            <dd>Non fourni par HYG</dd>
          </div>
        </dl>
        <p class="scientific-note">
          La taille du point représente l’éclat de l’étoile, pas son diamètre réel. La couleur est
          une approximation{{
            colorSource(star) === 'bv'
              ? ' calculée à partir de l’indice B−V'
              : colorSource(star) === 'spectral'
                ? ' fondée sur le type spectral'
                : ' neutre, faute de mesure disponible'
          }}. La température est une estimation photométrique, sans correction de l’extinction.
        </p>
        <h3>Identifiants du catalogue</h3>
        <div class="identifier-list">
          <v-chip
            v-for="identifier in identifiers"
            :key="String(identifier)"
            size="small"
            variant="outlined"
            >{{ identifier }}</v-chip
          >
        </div>
        <details class="advanced-data">
          <summary>Données complémentaires</summary>
          <dl class="data-grid">
            <div>
              <dt>Position cartésienne X / Y / Z (pc)</dt>
              <dd>
                {{ fmt(distance == null ? null : star.x) }} /
                {{ fmt(distance == null ? null : star.y) }} /
                {{ fmt(distance == null ? null : star.z) }}
              </dd>
            </div>
            <div>
              <dt>Vitesse X / Y / Z (pc/an)</dt>
              <dd>
                {{
                  distance == null
                    ? 'Non renseigné'
                    : `${star.vx ?? '—'} / ${star.vy ?? '—'} / ${star.vz ?? '—'}`
                }}
              </dd>
            </div>
            <div>
              <dt>Désignation variable</dt>
              <dd>{{ star.var || 'Non renseignée' }}</dd>
            </div>
            <div>
              <dt>Plage de magnitude variable</dt>
              <dd>{{ fmt(star.var_min) }} / {{ fmt(star.var_max) }}</dd>
            </div>
            <div>
              <dt>Composante / primaire</dt>
              <dd>{{ star.comp ?? '—' }} / {{ star.comp_primary ?? '—' }}</dd>
            </div>
            <div>
              <dt>Système</dt>
              <dd>{{ star.base || 'Non renseigné' }}</dd>
            </div>
          </dl>
        </details>
      </v-card-text>
      <v-card-actions class="dialog-actions"
        ><v-btn
          :append-icon="mdiArrowTopRight"
          :href="simbadUrl"
          target="_blank"
          rel="noopener noreferrer"
          variant="text"
          size="small"
          >Consulter SIMBAD</v-btn
        ><v-spacer /><v-btn
          :prepend-icon="mdiCrosshairsGps"
          variant="flat"
          color="primary"
          @click="emit('locate', star)"
          >Voir sur la carte</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>

<style scoped>
.star-hero-description {
  min-width: 0;
  padding-right: 22px;
}

.star-hero-description h2 {
  overflow-wrap: anywhere;
}

.assignment-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 24px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--line);
}

@media (height <= 500px) {
  .star-hero {
    padding-block: 12px;
  }

  .star-portrait {
    height: 44px;
  }

  .star-hero h2 {
    font-size: 25px;
  }

  .star-content.v-card-text {
    padding-top: 16px;
  }

  .dialog-actions {
    padding-block: 8px !important;
  }
}
</style>
