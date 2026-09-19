<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { mdiMagnify, mdiStarFourPoints } from '@mdi/js'
import SkyMap from './components/SkyMap.vue'
import StarDetails from './components/StarDetails.vue'
import StarAssignmentsPanel from './components/StarAssignmentsPanel.vue'
import DisplaySettings from './components/DisplaySettings.vue'
import DocumentSurface from './components/DocumentSurface.vue'
import SelectionCheck from './components/SelectionCheck.vue'
import RiddlesPage from './components/RiddlesPage.vue'
import { useStarAssignments } from './composables/useStarAssignments'
import { useSelectionCheck } from './composables/useSelectionCheck'
import { loadCatalog } from './lib/catalog'
import { starColor, starName, formatRa, formatDec } from './lib/astronomy'
import { buildSearchIndex, searchResultIdentifier, type SearchEntry } from './lib/starSearch'
import { searchSky, type SkySearchResult } from './lib/skySearch'
import type { AssignmentSlot } from './lib/starAssignments'
import type { SkyProjection } from './lib/skyProjection'
import type { Star } from './types/catalog'

const stars = shallowRef<Star[]>([])
const {
  assignments,
  storageAvailable,
  restore: restoreAssignments,
  assign,
  unassign,
} = useStarAssignments(stars)
const {
  status: unlockStatus,
  content: unlockedContent,
  retry: retryUnlock,
} = useSelectionCheck(assignments)
const searchIndex = shallowRef<SearchEntry[]>([])
const documentSurface = ref<InstanceType<typeof DocumentSurface> | null>(null)
const documentSelection = ref(false)
const documentTransition = ref(false)
const feedbackMessage = ref('')
const feedbackVisible = ref(false)
let feedbackId = 0

async function showFeedback(message: string) {
  const id = ++feedbackId
  feedbackVisible.value = false
  await nextTick()
  if (id !== feedbackId) return
  feedbackMessage.value = message
  feedbackVisible.value = true
}

function clearFeedback() {
  feedbackId += 1
  feedbackVisible.value = false
}

watch(unlockStatus, (status) => {
  clearFeedback()
  if (status === 'miss') void showFeedback('Ce ne sont pas les bonnes lumières')
})
const documentOpen = computed(() => unlockStatus.value === 'unlocked' && !!unlockedContent.value)
const atlasActive = computed(() => !documentOpen.value || documentSelection.value)
const map = ref<InstanceType<typeof SkyMap> | null>(null)
const selectedStar = shallowRef<Star | null>(null)
const emphasizedStar = shallowRef<Star | null>(null)
const loading = ref(true)
const loadError = ref('')
const query = ref('')
const searchOpen = ref(false)
const searchResults = shallowRef<SkySearchResult[]>([])
const activeResult = ref(0)
const projection = ref<SkyProjection>('plane')
const showGrid = ref(true)
const showStars = ref(true)
const showLabels = ref(true)
const showConstellationLabels = ref(true)
const showConstellations = ref(true)
const mobilePanel = ref(false)
const riddlesOpen = ref(window.location.hash === '#enigmes')
function updatePage() {
  riddlesOpen.value = window.location.hash === '#enigmes'
  mobilePanel.value = false
  selectedStar.value = null
  searchOpen.value = false
}
function navigatePage(event: MouseEvent, page: 'carte' | 'enigmes') {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  const hash = `#${page}`
  if (window.location.hash !== hash) window.history.pushState(null, '', hash)
  updatePage()
}
const view = ref({ ra: 6, dec: 12, zoom: 2.3, visibleCount: 0 })
let controller: AbortController | null = null
let searchTimer: ReturnType<typeof setTimeout> | undefined

async function fetchCatalog() {
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  loadError.value = ''
  try {
    const catalog = await loadCatalog(controller.signal)
    stars.value = catalog.stars
    searchIndex.value = buildSearchIndex(catalog.stars)
    restoreAssignments()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return
    loadError.value =
      'Le catalogue n’a pas pu être chargé. Vérifiez votre connexion puis réessayez.'
  } finally {
    loading.value = false
  }
}

function selectStar(star: Star) {
  if (!documentSelection.value) map.value?.focusStar(star)
  openStar(star)
  searchOpen.value = false
  mobilePanel.value = false
}

function openStar(star: Star) {
  if (documentOpen.value && documentSelection.value) {
    clearFeedback()
    selectedStar.value = null
    emphasizedStar.value = star
    map.value?.focusStar(star)
    documentSurface.value?.inspectSelection({ id: star.id, hip: star.hip })
    return
  }
  selectedStar.value = star
}

function requestDocumentSelection() {
  if (!documentOpen.value) return
  clearFeedback()
  documentSelection.value = true
  riddlesOpen.value = false
  selectedStar.value = null
  searchOpen.value = false
  query.value = ''
}

async function returnToDocument(star: Star | null = null) {
  if (!documentOpen.value || !documentSelection.value) return
  clearFeedback()
  documentSelection.value = false
  emphasizedStar.value = null
  selectedStar.value = null
  searchOpen.value = false
  mobilePanel.value = false
  await nextTick()
  documentSurface.value?.returnSelection(star ? { id: star.id, hip: star.hip } : null)
}

async function displayDocument(fade: boolean) {
  if (documentTransition.value || !documentSelection.value) return
  if (!fade) {
    await returnToDocument()
    return
  }
  documentTransition.value = true
  await new Promise((resolve) => setTimeout(resolve, 1100))
  await returnToDocument()
  await new Promise((resolve) => setTimeout(resolve, 100))
  documentTransition.value = false
}

watch(documentOpen, () => {
  documentSelection.value = false
  emphasizedStar.value = null
})

function locateStar(star: Star) {
  map.value?.focusStar(star)
  selectedStar.value = null
}

function assignAndClose(slot: AssignmentSlot, star: Star) {
  assign(slot, star)
  selectedStar.value = null
  mobilePanel.value = false
}

function selectResult(result: SkySearchResult) {
  clearTimeout(searchTimer)
  if (result.kind === 'star') {
    selectStar(result.star)
    return
  }
  selectedStar.value = null
  showConstellations.value = true
  map.value?.focusConstellation(result.constellation.code)
  searchOpen.value = false
  mobilePanel.value = false
}

function onSearchKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    searchOpen.value = true
    const length = searchResults.value.length
    activeResult.value = length
      ? (activeResult.value + (event.key === 'ArrowDown' ? 1 : -1) + length) % length
      : 0
  } else if (event.key === 'Enter') {
    const result = searchResults.value[activeResult.value]
    if (result) {
      event.preventDefault()
      selectResult(result)
    }
  } else if (event.key === 'Escape') {
    searchOpen.value = false
  }
}

watch(query, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchResults.value = searchSky(searchIndex.value, query.value ?? '', 12)
    activeResult.value = 0
    searchOpen.value = true
  }, 100)
})
onMounted(() => {
  window.addEventListener('hashchange', updatePage)
  window.addEventListener('popstate', updatePage)
  void fetchCatalog()
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', updatePage)
  window.removeEventListener('popstate', updatePage)
  controller?.abort()
  clearTimeout(searchTimer)
})
</script>

<template>
  <v-app>
    <v-snackbar v-model="feedbackVisible" :timeout="6000" location="bottom" role="status">
      {{ feedbackMessage }}
    </v-snackbar>
    <Transition name="document-fade">
      <div v-if="documentTransition" class="document-curtain" aria-hidden="true" />
    </Transition>
    <Transition name="page-change">
      <DocumentSurface
        v-if="documentOpen && unlockedContent"
        v-show="!documentSelection"
        ref="documentSurface"
        :content="unlockedContent"
        @request-selection="requestDocumentSelection"
        @request-display="displayDocument"
        @selection-checked="emphasizedStar = null"
        @feedback="showFeedback"
      />
    </Transition>
    <div v-show="atlasActive" class="atlas-shell">
      <header class="app-header">
        <a class="brand" href="./" aria-label="Sidéral, accueil"
          ><svg viewBox="0 0 40 40" aria-hidden="true">
            <path
              d="m20 2 3.8 14.2L38 20l-14.2 3.8L20 38l-3.8-14.2L2 20l14.2-3.8Z"
              fill="currentColor"
            />
            <circle cx="33" cy="7" r="2" /></svg
          ><span>SIDÉRAL</span></a
        >
        <div class="header-tools">
          <v-btn
            v-if="documentSelection"
            variant="text"
            :icon="mdiStarFourPoints"
            aria-label="Revenir"
            @click="returnToDocument()"
          />
          <nav class="page-navigation" aria-label="Navigation principale">
            <a
              href="#carte"
              :aria-current="!riddlesOpen ? 'page' : undefined"
              @click="navigatePage($event, 'carte')"
              >Carte</a
            >
            <a
              href="#enigmes"
              :aria-current="riddlesOpen ? 'page' : undefined"
              @click="navigatePage($event, 'enigmes')"
              >Énigmes</a
            >
          </nav>
          <v-btn
            v-if="!riddlesOpen"
            class="mobile-settings"
            :icon="mdiMagnify"
            variant="text"
            aria-label="Rechercher et régler la carte"
            @click="mobilePanel = !mobilePanel"
          />
        </div>
      </header>

      <RiddlesPage
        v-if="riddlesOpen"
        :assignments="assignments"
        @return-to-map="navigatePage($event, 'carte')"
      />
      <main v-show="!riddlesOpen" class="app-workspace">
        <button
          v-if="mobilePanel"
          class="panel-backdrop"
          aria-label="Fermer les réglages"
          @click="mobilePanel = false"
        />
        <aside
          class="explorer-panel"
          :class="{ 'is-open': mobilePanel }"
          aria-label="Recherche et réglages de la carte"
        >
          <div
            class="search-area"
            @focusout="
              (event) => {
                if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node))
                  searchOpen = false
              }
            "
          >
            <v-text-field
              v-model="query"
              :prepend-inner-icon="mdiMagnify"
              placeholder="Étoile ou constellation…"
              aria-label="Rechercher une étoile ou une constellation"
              :disabled="loading || !!loadError"
              :loading="loading"
              variant="outlined"
              density="comfortable"
              hide-details
              clearable
              :model-modifiers="{ trim: true }"
              role="combobox"
              aria-autocomplete="list"
              :aria-expanded="searchOpen && !!query"
              aria-controls="sky-search-results"
              :aria-activedescendant="
                searchOpen && searchResults.length ? `search-result-${activeResult}` : undefined
              "
              @click:clear="query = ''"
              @focus="searchOpen = true"
              @keydown="onSearchKey"
            />
            <div
              v-if="searchOpen && query"
              id="sky-search-results"
              class="search-results"
              role="listbox"
              aria-label="Résultats de recherche"
            >
              <button
                v-for="(result, index) in searchResults"
                :id="`search-result-${index}`"
                :key="
                  result.kind === 'star'
                    ? `star-${result.star.id}`
                    : `constellation-${result.constellation.code}`
                "
                class="search-result"
                :class="{ 'is-active': index === activeResult }"
                role="option"
                :aria-selected="index === activeResult"
                @mousedown.prevent
                @click="selectResult(result)"
              >
                <template v-if="result.kind === 'star'">
                  <i :style="{ background: starColor(result.star) }" /><span
                    ><strong>{{ starName(result.star) }}</strong
                    ><small
                      >{{ searchResultIdentifier(result.star, query) }} ·
                      {{ result.star.con || '—' }}</small
                    ></span
                  ><em>{{ result.star.mag.toFixed(2) }}</em>
                </template>
                <template v-else>
                  <svg class="constellation-result-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m4 17 5-12 6 14 5-10M4 17l11 2" />
                    <circle cx="4" cy="17" r="1.6" />
                    <circle cx="9" cy="5" r="1.6" />
                    <circle cx="15" cy="19" r="1.6" />
                    <circle cx="20" cy="9" r="1.6" />
                  </svg>
                  <span
                    ><strong>{{ result.name }}</strong
                    ><small>Constellation · {{ result.constellation.name }}</small></span
                  >
                  <em>{{ result.constellation.code }}</em>
                </template>
              </button>
              <p v-if="!searchResults.length" class="empty-search">
                Aucun résultat.<br /><small>Essayez « Sirius », « Orion » ou « HIP 32349 ».</small>
              </p>
            </div>
          </div>
          <StarAssignmentsPanel
            v-if="!documentSelection"
            :assignments="assignments"
            :storage-available="storageAvailable"
            :loading="loading"
            @unassign="unassign"
          />
        </aside>

        <section class="sky-workspace" aria-label="Exploration du ciel">
          <SkyMap
            ref="map"
            :active="atlasActive && !riddlesOpen"
            :stars="stars"
            :selected-star="selectedStar"
            :emphasized-star="emphasizedStar"
            :assigned-stars="assignments"
            :animate-selection="unlockStatus === 'checking'"
            :projection="projection"
            :show-grid="showGrid"
            :show-stars="showStars"
            :show-labels="showLabels"
            :show-constellation-labels="showConstellationLabels"
            :show-constellations="showConstellations"
            @select="openStar"
            @view-change="view = $event"
          />
          <div
            v-if="loading || loadError"
            class="map-state"
            :class="{ 'is-loading': loading }"
            role="status"
            aria-live="polite"
          >
            <template v-if="loading">
              <v-icon
                class="map-loading-star"
                :icon="mdiStarFourPoints"
                color="primary"
                size="32"
                aria-hidden="true"
              />
              <p class="map-loading-label">Chargement…</p>
            </template>
            <template v-else>
              <v-icon :icon="mdiStarFourPoints" color="primary" size="32" />
              <strong>Le ciel attendra un instant</strong>
              <p>{{ loadError }}</p>
              <v-btn color="primary" variant="tonal" @click="fetchCatalog">Réessayer</v-btn>
            </template>
          </div>
          <SelectionCheck :status="unlockStatus" @retry="retryUnlock" />
          <div class="map-footer">
            <div class="map-coordinates">
              <span
                >AD <strong>{{ formatRa(view.ra) }}</strong></span
              ><span
                >DÉC <strong>{{ formatDec(view.dec) }}</strong></span
              >
            </div>
            <DisplaySettings
              v-model:projection="projection"
              v-model:stars="showStars"
              v-model:constellations="showConstellations"
              v-model:grid="showGrid"
              v-model:labels="showLabels"
              v-model:constellation-labels="showConstellationLabels"
            />
          </div>
        </section>
      </main>

      <StarDetails
        :star="selectedStar"
        :assignments="assignments"
        :editable="!documentSelection"
        @close="selectedStar = null"
        @locate="locateStar"
        @assign="assignAndClose"
        @unassign="unassign"
      >
        <template #storage-notice>
          <p v-if="!storageAvailable" class="assignment-storage-note" role="status">
            Sauvegarde indisponible : vos choix restent dans cette session.
          </p>
        </template>
      </StarDetails>
    </div>
  </v-app>
</template>

<style scoped>
.document-curtain {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: #000;
}

.document-fade-enter-active,
.document-fade-leave-active {
  transition: opacity 1s ease;
}

.document-fade-enter-from,
.document-fade-leave-to {
  opacity: 0;
}

.atlas-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.page-change-leave-active {
  transition:
    opacity 450ms ease,
    filter 450ms ease;
}

.page-change-enter-active {
  transition: opacity 700ms ease;
}

.page-change-enter-from,
.page-change-leave-to {
  opacity: 0;
}

.page-change-leave-to {
  filter: blur(5px);
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .page-change-leave-active,
  .page-change-enter-active {
    transition: none;
  }

  .page-change-leave-to {
    filter: none;
  }
}

.assignment-storage-note {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.6;
  color: #c4b99f;
}
</style>
