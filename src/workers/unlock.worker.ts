import {
  decryptUnlock,
  type UnlockWorkerRequest,
  type UnlockWorkerResponse,
} from '../lib/unlockCrypto'

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<UnlockWorkerRequest>) => void) | null
  postMessage: (response: UnlockWorkerResponse) => void
}

scope.onmessage = async ({ data }) => {
  try {
    const content = await decryptUnlock(data.envelope, data.tokens)
    scope.postMessage(content ? { status: 'unlocked', content } : { status: 'miss' })
  } catch {
    scope.postMessage({ status: 'error' })
  }
}
