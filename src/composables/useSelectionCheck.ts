import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import {
  parseUnlockEnvelope,
  starUnlockToken,
  type UnlockEnvelope,
  type UnlockedContent,
  type UnlockWorkerRequest,
  type UnlockWorkerResponse,
} from '../lib/unlockCrypto'
import type { Star } from '../types/catalog'

export type SelectionCheckStatus = 'idle' | 'checking' | 'miss' | 'unlocked' | 'error'

export function useSelectionCheck(assignments: Readonly<Ref<readonly (Star | null)[]>>) {
  const status = ref<SelectionCheckStatus>('idle')
  const content = shallowRef<UnlockedContent | null>(null)
  const selection = computed(() => {
    const [first, second, third] = assignments.value
    if (assignments.value.length !== 3 || !first || !second || !third) return null
    return JSON.stringify([starUnlockToken(first), starUnlockToken(second), starUnlockToken(third)])
  })
  let envelope: UnlockEnvelope | null = null
  let controller: AbortController | null = null
  let worker: Worker | null = null
  let attempt = 0

  function cancel() {
    attempt += 1
    controller?.abort()
    controller = null
    worker?.terminate()
    worker = null
  }

  async function unlock(signature: string) {
    cancel()
    const currentAttempt = attempt
    content.value = null
    status.value = 'checking'
    controller = new AbortController()

    function finish(response: UnlockWorkerResponse) {
      if (currentAttempt !== attempt) return
      worker?.terminate()
      worker = null
      controller = null
      content.value = response.status === 'unlocked' ? response.content : null
      status.value = response.status
    }

    try {
      if (!envelope) {
        const response = await fetch(`${import.meta.env.BASE_URL}data/selection.json`, {
          signal: controller.signal,
          cache: 'no-cache',
        })
        if (!response.ok) throw new Error('Unavailable')
        const parsed = parseUnlockEnvelope(await response.json())
        if (currentAttempt !== attempt) return
        envelope = parsed
      }
      if (currentAttempt !== attempt) return

      worker = new Worker(new URL('../workers/unlock.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (event: MessageEvent<UnlockWorkerResponse>) => finish(event.data)
      worker.onerror = (event) => {
        event.preventDefault()
        finish({ status: 'error' })
      }
      worker.onmessageerror = () => finish({ status: 'error' })
      worker.postMessage({
        tokens: JSON.parse(signature) as UnlockWorkerRequest['tokens'],
        envelope,
      } satisfies UnlockWorkerRequest)
    } catch {
      if (currentAttempt === attempt) finish({ status: 'error' })
    }
  }

  function retry() {
    if (status.value === 'error' && selection.value) void unlock(selection.value)
  }

  watch(
    selection,
    (signature) => {
      if (signature) {
        void unlock(signature)
      } else {
        cancel()
        content.value = null
        status.value = 'idle'
      }
    },
    { immediate: true },
  )

  onScopeDispose(cancel)

  return { status, content, retry }
}
