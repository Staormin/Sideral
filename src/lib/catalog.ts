import { STAR_FIELDS, type Catalog, type CatalogMetadata, type Star } from '../types/catalog'

const STRING_FIELDS = new Set<keyof Star>([
  'gl',
  'bf',
  'proper',
  'spect',
  'bayer',
  'flam',
  'con',
  'base',
  'var',
])
const INTEGER_FIELDS = new Set<keyof Star>(['id', 'hip', 'hd', 'hr', 'comp', 'comp_primary'])
const REQUIRED_FIELDS = new Set<keyof Star>(['id', 'ra', 'dec', 'mag'])

function invalid(reason: string): never {
  throw new Error(`Catalogue invalide : ${reason}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(`champ ${field} manquant.`)
  return value
}

function integerValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(`champ ${field} incorrect.`)
  }
  return value
}

function readMetadata(value: unknown): CatalogMetadata {
  if (!isRecord(value)) invalid('métadonnées absentes.')
  return {
    name: stringValue(value.name, 'name'),
    version: stringValue(value.version, 'version'),
    count: integerValue(value.count, 'count'),
    epoch: stringValue(value.epoch, 'epoch'),
    license: stringValue(value.license, 'license'),
    licenseUrl: stringValue(value.licenseUrl, 'licenseUrl'),
    source: stringValue(value.source, 'source'),
    revision: stringValue(value.revision, 'revision'),
    sourceSha256: stringValue(value.sourceSha256, 'sourceSha256'),
    excludedSun: integerValue(value.excludedSun, 'excludedSun'),
    fields: integerValue(value.fields, 'fields'),
  }
}

function readHeader(value: unknown): { metadata: CatalogMetadata; rows: unknown[] } {
  if (!isRecord(value) || value.schemaVersion !== 1) invalid('version de format inconnue.')
  const columns: unknown = value.columns
  if (
    !Array.isArray(columns) ||
    columns.length !== STAR_FIELDS.length ||
    STAR_FIELDS.some((field, index) => columns[index] !== field)
  ) {
    invalid('la liste des colonnes ne correspond pas au format HYG attendu.')
  }
  const metadata = readMetadata(value.metadata)
  const rows: unknown = value.rows
  if (!Array.isArray(rows) || rows.length !== metadata.count || rows.length === 0) {
    invalid("le nombre d'étoiles ne correspond pas aux métadonnées.")
  }
  if (metadata.fields !== STAR_FIELDS.length) invalid('nombre de champs incorrect.')
  return { metadata, rows }
}

function assertStar(
  value: Record<string, unknown>,
  rowNumber: number,
): asserts value is Record<string, unknown> & Star {
  for (const field of STAR_FIELDS) {
    const entry = value[field]
    if (entry === null && !REQUIRED_FIELDS.has(field)) continue
    const correctType = STRING_FIELDS.has(field)
      ? typeof entry === 'string'
      : typeof entry === 'number' && Number.isFinite(entry)
    if (!correctType || (INTEGER_FIELDS.has(field) && !Number.isSafeInteger(entry))) {
      invalid(`valeur ${field} incorrecte à la ligne ${rowNumber}.`)
    }
  }
  // The scalar checks above guarantee these primitive types.
  const id = value.id as number
  const ra = value.ra as number
  const dec = value.dec as number
  if (id <= 0 || ra < 0 || ra >= 24 || dec < -90 || dec > 90) {
    invalid(`identifiant ou coordonnées hors limites à la ligne ${rowNumber}.`)
  }
}

function readStar(row: unknown, index: number, ids: Set<number>): Star {
  if (!Array.isArray(row) || row.length !== STAR_FIELDS.length) {
    invalid(`ligne ${index + 1} incomplète.`)
  }
  const star: Record<string, unknown> = {}
  for (let column = 0; column < STAR_FIELDS.length; column += 1) {
    const field = STAR_FIELDS[column]
    if (field !== undefined) star[field] = row[column]
  }
  assertStar(star, index + 1)
  if (ids.has(star.id)) invalid(`identifiant HYG ${star.id} présent plusieurs fois.`)
  ids.add(star.id)
  return star
}

/** Validate the untrusted JSON boundary, including every individual field. */
export function parseCatalog(value: unknown): Catalog {
  const { metadata, rows } = readHeader(value)
  const ids = new Set<number>()
  return { metadata, stars: rows.map((row, index) => readStar(row, index, ids)) }
}

async function decodeCompressedAsset(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Le fichier compressé est vide.')
  const reader = response.body.getReader()
  const prefix: Uint8Array<ArrayBuffer>[] = []
  let prefixLength = 0
  while (prefixLength < 2) {
    const { done, value } = await reader.read()
    if (done) break
    if (value.length > 0) {
      prefix.push(value)
      prefixLength += value.length
    }
  }
  const first = prefix[0]
  const secondByte = first && first.length > 1 ? first[1] : prefix[1]?.[0]
  const isGzip = first?.[0] === 0x1f && secondByte === 0x8b
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const chunk of prefix) controller.enqueue(chunk)
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  // Fetch may already decode Content-Encoding: gzip (e.g. Vite's static server).
  // Inspect bytes rather than headers to also support raw .gz and proxy encodings.
  const decoded = isGzip ? stream.pipeThrough(new DecompressionStream('gzip')) : stream
  return await new Response(decoded).json()
}

async function fetchCatalogJson(signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted()
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const compressed = await fetch(`${import.meta.env.BASE_URL}data/stars.json.gz`, {
        signal: signal ?? null,
      })
      if (compressed.ok && compressed.body) {
        return await decodeCompressedAsset(compressed)
      }
      await compressed.body?.cancel()
    } catch (error) {
      if (signal?.aborted) throw error
      // A missing/corrupt compressed asset or unsupported implementation can use plain JSON.
    }
  }
  signal?.throwIfAborted()
  const response = await fetch(`${import.meta.env.BASE_URL}data/stars.json`, {
    signal: signal ?? null,
  })
  if (!response.ok) {
    throw new Error(
      `Le catalogue est indisponible (HTTP ${response.status}). Réessayez dans un instant.`,
    )
  }
  try {
    return await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Le fichier des étoiles est illisible. Rechargez la page pour réessayer.', {
      cause: error,
    })
  }
}

/** Same validation as parseCatalog, yielding between batches to keep controls responsive. */
export async function loadCatalog(signal?: AbortSignal): Promise<Catalog> {
  const value = await fetchCatalogJson(signal)
  const { metadata, rows } = readHeader(value)
  const ids = new Set<number>()
  const stars: Star[] = []
  for (let offset = 0; offset < rows.length; offset += 2000) {
    signal?.throwIfAborted()
    const end = Math.min(offset + 2000, rows.length)
    for (let index = offset; index < end; index += 1) {
      stars.push(readStar(rows[index], index, ids))
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  signal?.throwIfAborted()
  return { metadata, stars }
}
