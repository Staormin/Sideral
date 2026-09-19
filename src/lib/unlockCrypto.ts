import { argon2id } from 'hash-wasm'
import { gcm } from '@noble/ciphers/aes.js'

export type StarTokens = readonly [string, string, string]

export interface UnlockEnvelope {
  version: 1
  kdf: {
    name: 'argon2id'
    memoryKiB: number
    iterations: number
    parallelism: 1
    salt: string
  }
  cipher: {
    name: 'AES-GCM'
    iv: string
    ciphertext: string
  }
}

export interface UnlockedTextContent {
  version: 1
  title: string
  paragraphs: string[]
}

export interface UnlockedDocumentContent {
  version: 2
  document: string
}

export type UnlockedContent = UnlockedTextContent | UnlockedDocumentContent

export interface UnlockWorkerRequest {
  envelope: UnlockEnvelope
  tokens: StarTokens
}

export type UnlockWorkerResponse =
  { status: 'unlocked'; content: UnlockedContent } | { status: 'miss' } | { status: 'error' }

const CONTEXT = 'sideral-unlock-v1'
const MAX_DOCUMENT_BYTES = 1_048_576
// JSON can expand a single document byte to a six-byte escaped sequence.
const MAX_PLAINTEXT_BYTES = MAX_DOCUMENT_BYTES * 6 + 512
const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + 16
const encoder = new TextEncoder()

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  )
}

function decodeBase64(value: unknown, minimum: number, maximum: number): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(maximum / 3) * 4 ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(value)
  ) {
    throw new Error('Invalid encrypted content')
  }

  let decoded: string
  try {
    decoded = atob(value)
  } catch {
    throw new Error('Invalid encrypted content')
  }
  if (decoded.length < minimum || decoded.length > maximum || btoa(decoded) !== value) {
    throw new Error('Invalid encrypted content')
  }
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

function parseKdf(input: unknown): UnlockEnvelope['kdf'] {
  if (
    !record(input) ||
    input.name !== 'argon2id' ||
    !integerInRange(input.memoryKiB, 8, 262_144) ||
    !integerInRange(input.iterations, 1, 256) ||
    input.parallelism !== 1 ||
    typeof input.salt !== 'string'
  ) {
    throw new Error('Invalid encrypted content')
  }
  decodeBase64(input.salt, 16, 64)
  return {
    name: 'argon2id',
    memoryKiB: input.memoryKiB,
    iterations: input.iterations,
    parallelism: 1,
    salt: input.salt,
  }
}

export function parseUnlockEnvelope(input: unknown): UnlockEnvelope {
  if (
    !record(input) ||
    input.version !== 1 ||
    !record(input.cipher) ||
    input.cipher.name !== 'AES-GCM' ||
    typeof input.cipher.iv !== 'string' ||
    typeof input.cipher.ciphertext !== 'string'
  ) {
    throw new Error('Invalid encrypted content')
  }
  const kdf = parseKdf(input.kdf)
  decodeBase64(input.cipher.iv, 12, 12)
  decodeBase64(input.cipher.ciphertext, 16, MAX_CIPHERTEXT_BYTES)
  return {
    version: 1,
    kdf,
    cipher: {
      name: 'AES-GCM',
      iv: input.cipher.iv,
      ciphertext: input.cipher.ciphertext,
    },
  }
}

export function starUnlockToken(star: { id: number; hip: number | null }): string {
  if (integerInRange(star.hip, 1, Number.MAX_SAFE_INTEGER)) return `HIP:${star.hip}`
  if (integerInRange(star.id, 1, Number.MAX_SAFE_INTEGER)) return `HYG:${star.id}`
  throw new Error('Invalid star selection')
}

export function serializeSelection(tokens: StarTokens): string {
  if (
    !Array.isArray(tokens) ||
    tokens.length !== 3 ||
    ![tokens[0], tokens[1], tokens[2]].every((token) => {
      if (typeof token !== 'string' || !/^(HIP|HYG):[1-9]\d{0,15}$/.test(token)) return false
      return Number.isSafeInteger(Number(token.slice(4)))
    })
  ) {
    throw new Error('Invalid star selection')
  }
  return JSON.stringify([CONTEXT, ...tokens])
}

export async function deriveUnlockKey(
  tokens: StarTokens,
  input: UnlockEnvelope['kdf'],
): Promise<Uint8Array<ArrayBuffer>> {
  const kdf = parseKdf(input)
  const password = encoder.encode(serializeSelection(tokens))
  try {
    const derived = await argon2id({
      password,
      salt: decodeBase64(kdf.salt, 16, 64),
      memorySize: kdf.memoryKiB,
      iterations: kdf.iterations,
      parallelism: kdf.parallelism,
      hashLength: 32,
      outputType: 'binary',
    })
    const key = new Uint8Array(derived)
    derived.fill(0)
    return key
  } finally {
    password.fill(0)
  }
}

function parseUnlockedContent(input: unknown): UnlockedContent {
  if (record(input) && input.version === 2) {
    if (
      typeof input.document !== 'string' ||
      input.document.trim().length === 0 ||
      input.document.length > MAX_DOCUMENT_BYTES ||
      encoder.encode(input.document).byteLength > MAX_DOCUMENT_BYTES
    ) {
      throw new Error('Invalid unlocked content')
    }
    return { version: 2, document: input.document }
  }

  if (
    !record(input) ||
    input.version !== 1 ||
    typeof input.title !== 'string' ||
    input.title.trim().length === 0 ||
    input.title.length > 200 ||
    !Array.isArray(input.paragraphs) ||
    input.paragraphs.length < 1 ||
    input.paragraphs.length > 100 ||
    !input.paragraphs.every(
      (paragraph) => typeof paragraph === 'string' && paragraph.length <= 10_000,
    )
  ) {
    throw new Error('Invalid unlocked content')
  }
  return { version: 1, title: input.title, paragraphs: [...input.paragraphs] }
}

export async function decryptUnlock(
  input: UnlockEnvelope,
  tokens: StarTokens,
): Promise<UnlockedContent | null> {
  const envelope = parseUnlockEnvelope(input)
  const iv = decodeBase64(envelope.cipher.iv, 12, 12)
  const additionalData = encoder.encode(CONTEXT)
  const ciphertext = decodeBase64(envelope.cipher.ciphertext, 16, MAX_CIPHERTEXT_BYTES)
  const rawKey = await deriveUnlockKey(tokens, envelope.kdf)
  let bytes: Uint8Array
  try {
    const subtle = globalThis.crypto?.subtle
    if (subtle) {
      const key = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'])
      try {
        bytes = new Uint8Array(
          await subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
            key,
            ciphertext,
          ),
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === 'OperationError') return null
        throw new Error('Unable to decrypt content', { cause: error })
      }
    } else {
      // WebCrypto is unavailable on HTTP LAN origins; retain authenticated AES-GCM.
      const cipher = gcm(rawKey, iv, additionalData)
      try {
        bytes = cipher.decrypt(ciphertext)
      } catch (error) {
        if (error instanceof Error && error.message === 'aes-gcm: invalid tag') return null
        throw new Error('Unable to decrypt content', { cause: error })
      }
    }
  } finally {
    rawKey.fill(0)
  }
  try {
    const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return parseUnlockedContent(decoded)
  } catch {
    throw new Error('Invalid unlocked content')
  } finally {
    bytes.fill(0)
  }
}
