import { readFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STAR_FIELDS } from '../types/catalog'
import { loadCatalog, parseCatalog } from './catalog'
import { distanceLy, starName } from './astronomy'

function sample() {
  const star = { id: 32263, proper: 'Sirius', ra: 6.752481, dec: -16.716116, mag: -1.44 }
  return {
    schemaVersion: 1,
    metadata: {
      name: 'HYG Database',
      version: '4.1',
      count: 1,
      epoch: 'J2000.0',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      source: 'https://example.test/catalog.csv',
      revision: 'test',
      sourceSha256: 'test',
      excludedSun: 1,
      fields: STAR_FIELDS.length,
    },
    columns: [...STAR_FIELDS],
    rows: [
      STAR_FIELDS.map((field): unknown =>
        field in star ? star[field as keyof typeof star] : null,
      ),
    ],
  }
}

describe('catalogue boundary validation', () => {
  it('preserves absent values as null instead of inventing zero measurements', () => {
    const catalogue = parseCatalog(sample())
    expect(catalogue.stars[0]?.ci).toBeNull()
    expect(catalogue.stars[0]?.mag).toBe(-1.44)
    expect(catalogue.stars[0]?.proper).toBe('Sirius')
  })

  it('rejects truncated data, invalid coordinates, and duplicate identifiers', () => {
    const truncated = sample()
    truncated.rows[0]?.pop()
    expect(() => parseCatalog(truncated)).toThrow('incomplète')
    const badPosition = sample()
    badPosition.rows[0]![STAR_FIELDS.indexOf('ra')] = 24
    expect(() => parseCatalog(badPosition)).toThrow('hors limites')
    const duplicate = sample()
    duplicate.rows.push([...duplicate.rows[0]!])
    duplicate.metadata.count = 2
    expect(() => parseCatalog(duplicate)).toThrow('plusieurs fois')
  })

  it('rejects schema drift, incorrect types, and a lying count', () => {
    const changedSchema = sample()
    changedSchema.schemaVersion = 2
    expect(() => parseCatalog(changedSchema)).toThrow('version de format')
    const wrongType = sample()
    wrongType.rows[0]![STAR_FIELDS.indexOf('mag')] = '-1.44'
    expect(() => parseCatalog(wrongType)).toThrow('mag incorrecte')
    const wrongCount = sample()
    wrongCount.metadata.count = 2
    expect(() => parseCatalog(wrongCount)).toThrow('nombre')
  })

  it('validates the shipped complete release and reference stars', () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('../../public/data/stars.json', import.meta.url), 'utf8'),
    )
    const catalogue = parseCatalog(raw)
    expect(catalogue.stars).toHaveLength(119625)
    expect(catalogue.metadata.fields).toBe(37)
    expect(catalogue.stars.some((star) => star.id === 0)).toBe(false)
    const sirius = catalogue.stars.find((star) => star.hip === 32349)
    expect(sirius).toMatchObject({ proper: 'Sirius', mag: -1.44, ra: 6.752481, dec: -16.716116 })
    if (!sirius) throw new Error('Sirius absent du catalogue')
    expect(starName(sirius)).toBe('Sirius')
    expect(distanceLy(sirius)).toBeCloseTo(8.601, 3)
    expect(catalogue.stars.find((star) => star.proper === 'Betelgeuse')?.ci).toBeGreaterThan(1)
  })

  it('ships a deterministic gzip that expands to the exact readable JSON', () => {
    const json = readFileSync(new URL('../../public/data/stars.json', import.meta.url))
    const gzip = readFileSync(new URL('../../public/data/stars.json.gz', import.meta.url))
    expect(gunzipSync(gzip).equals(json)).toBe(true)
    expect(gzip.readUInt32LE(4)).toBe(0)
    expect(gzip.length).toBeLessThan(json.length / 2)
  })
})

describe('catalogue compressed delivery', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('decodes gzip in the browser without requiring HTTP compression headers', async () => {
    const compressed = gzipSync(JSON.stringify(sample()))
    const fetchMock = vi.fn().mockResolvedValue(new Response(compressed))
    vi.stubGlobal('fetch', fetchMock)
    const catalogue = await loadCatalog()
    expect(catalogue.stars[0]?.proper).toBe('Sirius')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/data/stars.json.gz')
  })

  it('does not decompress twice when HTTP Content-Encoding already decoded the body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(sample()), { headers: { 'Content-Encoding': 'gzip' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    expect((await loadCatalog()).stars[0]?.proper).toBe('Sirius')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('recognizes gzip even when its signature spans response chunks', async () => {
    const compressed = gzipSync(JSON.stringify(sample()))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(compressed.subarray(0, 1))
        controller.enqueue(compressed.subarray(1))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream))
    vi.stubGlobal('fetch', fetchMock)
    expect((await loadCatalog()).stars[0]?.proper).toBe('Sirius')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('falls back to JSON when the gzip asset is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(sample()))
    vi.stubGlobal('fetch', fetchMock)
    expect((await loadCatalog()).stars).toHaveLength(1)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/data/stars.json')
  })

  it('uses plain JSON on browsers without DecompressionStream', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    const fetchMock = vi.fn().mockResolvedValue(Response.json(sample()))
    vi.stubGlobal('fetch', fetchMock)
    expect((await loadCatalog()).stars).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/data/stars.json')
  })

  it('propagates cancellation without starting a fallback request', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort()
      return Promise.reject(controller.signal.reason)
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadCatalog(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
