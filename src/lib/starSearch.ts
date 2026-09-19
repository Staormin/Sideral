import type { Star } from '../types/catalog'
import { starName } from './astronomy'

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export interface SearchEntry {
  star: Star
  name: string
  identifiers: string[]
  text: string
}

export function searchResultIdentifier(star: Star, query: string | null | undefined): string {
  const identifiers = [
    star.hip ? `HIP ${star.hip}` : '',
    star.hd ? `HD ${star.hd}` : '',
    star.hr ? `HR ${star.hr}` : '',
    `HYG ${star.id}`,
    star.gl ?? '',
    star.bf ?? '',
  ].filter(Boolean)
  const needle = normalizeSearch(query ?? '')
  return (
    (needle &&
      (identifiers.find((identifier) => normalizeSearch(identifier) === needle) ||
        identifiers.find((identifier) => normalizeSearch(identifier).includes(needle)))) ||
    identifiers[0]!
  )
}

export function buildSearchIndex(stars: Star[]): SearchEntry[] {
  return stars.map((star) => {
    const name = normalizeSearch(starName(star))
    const identifiers = [
      star.hip ? `hip${star.hip}` : '',
      star.hd ? `hd${star.hd}` : '',
      star.hr ? `hr${star.hr}` : '',
      `hyg${star.id}`,
      normalizeSearch(star.gl ?? ''),
      normalizeSearch(star.bf ?? ''),
    ].filter(Boolean)
    return { star, name, identifiers, text: [name, ...identifiers].join(' ') }
  })
}

export function searchStars(index: SearchEntry[], query: string, limit = 30): Star[] {
  const needle = normalizeSearch(query)
  if (!needle) return []
  return index
    .filter((entry) => entry.text.includes(needle))
    .map((entry) => ({
      entry,
      rank:
        entry.name === needle || entry.identifiers.includes(needle)
          ? 0
          : entry.name.startsWith(needle)
            ? 1
            : 2,
    }))
    .sort((a, b) => a.rank - b.rank || a.entry.star.mag - b.entry.star.mag)
    .slice(0, limit)
    .map(({ entry }) => entry.star)
}
