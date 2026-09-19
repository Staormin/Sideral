<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  parseUnlockEnvelope,
  serializeSelection,
  type StarTokens,
  type UnlockedContent,
  type UnlockWorkerResponse,
} from '../lib/unlockCrypto'

const props = defineProps<{ content: UnlockedContent }>()
const emit = defineEmits<{
  'request-selection': []
  'request-display': [fade: boolean]
  'selection-checked': []
}>()
const frame = ref<HTMLIFrameElement | null>(null)
const ready = ref(false)
let selectionRequested = false
let decoder: Worker | null = null
let decodeAttempt = 0

function cancelDecode(): void {
  decodeAttempt += 1
  decoder?.terminate()
  decoder = null
}

function decodeDocument(data: { id?: unknown; envelope?: unknown; tokens?: unknown }): void {
  if (!selectionRequested || !Number.isSafeInteger(data.id)) return
  cancelDecode()
  const attempt = decodeAttempt
  const reply = (response: UnlockWorkerResponse) => {
    if (attempt !== decodeAttempt) return
    decoder?.terminate()
    decoder = null
    emit('selection-checked')
    frame.value?.contentWindow?.postMessage(
      { type: 'document:decoded', id: data.id, ...response },
      '*',
    )
  }
  try {
    const envelope = parseUnlockEnvelope(data.envelope)
    const tokens = data.tokens as StarTokens
    serializeSelection(tokens)
    decoder = new Worker(new URL('../workers/unlock.worker.ts', import.meta.url), {
      type: 'module',
    })
    decoder.onmessage = (event: MessageEvent<UnlockWorkerResponse>) => reply(event.data)
    decoder.onerror = (event) => {
      event.preventDefault()
      reply({ status: 'error' })
    }
    decoder.onmessageerror = () => reply({ status: 'error' })
    decoder.postMessage({ envelope, tokens })
  } catch {
    reply({ status: 'error' })
  }
}

function receiveMessage(event: MessageEvent): void {
  if (!ready.value || event.source !== frame.value?.contentWindow) return
  if (event.data?.type === 'document:decode') {
    decodeDocument(event.data)
    return
  }
  if (event.data?.type === 'document:reset') {
    try {
      localStorage.clear()
      window.location.reload()
    } catch {
      frame.value?.contentWindow?.postMessage({ type: 'document:reset-failed' }, '*')
    }
    return
  }
  if (event.data?.type === 'document:request-display' && selectionRequested) {
    emit('request-display', event.data.transition === 'fade')
    return
  }
  if (event.data?.type !== 'document:request-selection' || selectionRequested) return
  selectionRequested = true
  emit('request-selection')
}

function inspectSelection(selection: { id: number; hip: number | null }): void {
  if (!selectionRequested) return
  cancelDecode()
  frame.value?.contentWindow?.postMessage({ type: 'document:selection', selection }, '*')
}

function returnSelection(selection: { id: number; hip: number | null } | null): void {
  if (!selectionRequested) return
  selectionRequested = false
  cancelDecode()
  frame.value?.contentWindow?.postMessage({ type: 'document:selection', selection }, '*')
  frame.value?.focus({ preventScroll: true })
}

onMounted(() => window.addEventListener('message', receiveMessage))
onBeforeUnmount(() => {
  cancelDecode()
  window.removeEventListener('message', receiveMessage)
})
defineExpose({ returnSelection, inspectSelection })
const policy = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const source = computed(() => {
  if (props.content.version !== 2) return ''
  // Apply the policy before the parser encounters any supplied markup or resources.
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${props.content.document}`
})

function loaded(): void {
  ready.value = true
  frame.value?.focus({ preventScroll: true })
}
</script>

<template>
  <section class="document-surface" aria-label="Contenu">
    <iframe
      v-if="content.version === 2"
      ref="frame"
      class="document-surface__frame"
      :class="{ 'is-ready': ready }"
      :srcdoc="source"
      title="Contenu"
      sandbox="allow-scripts"
      allow="autoplay *"
      referrerpolicy="no-referrer"
      @load="loaded"
    />
    <main v-else class="document-surface__text">
      <article>
        <h1>{{ content.title }}</h1>
        <p v-for="(paragraph, index) in content.paragraphs" :key="index">{{ paragraph }}</p>
      </article>
    </main>
  </section>
</template>

<style scoped>
.document-surface {
  position: absolute;
  inset: 0;
  z-index: 30;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #050810;
}

.document-surface__frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  opacity: 0;
  transition: opacity 600ms ease;
}

.document-surface__frame.is-ready {
  opacity: 1;
}

.document-surface__text {
  width: 100%;
  height: 100%;
  padding: clamp(28px, 6vw, 80px);
  overflow: auto;
}

.document-surface__text article {
  width: 100%;
  max-width: 640px;
  margin-inline: auto;
}

.document-surface__text h1 {
  margin-bottom: 28px;
  font-family: Georgia, serif;
  font-size: clamp(28px, 5vw, 44px);
  font-weight: 400;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.document-surface__text p {
  color: #c4c9d2;
  font-size: 16px;
  line-height: 1.9;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.document-surface__text p + p {
  margin-top: 20px;
}

@media (prefers-reduced-motion: reduce) {
  .document-surface__frame {
    transition: none;
  }
}
</style>
