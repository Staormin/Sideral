import type { Star } from '../types/catalog'
import { CONSTELLATION_NAMES_FR } from './constellationNames'
import { CONSTELLATION_FIGURES, type ConstellationFigure } from './skyConstellations'
import { normalizeSearch, type SearchEntry } from './starSearch'

export type SkySearchResult =
  | { kind: 'star'; star: Star }
  | { kind: 'constellation'; constellation: ConstellationFigure; name: string }

interface RankedResult {
  result: SkySearchResult
  rank: number
}

const constellationIndex = CONSTELLATION_FIGURES.map((constellation) => {
  const name = CONSTELLATION_NAMES_FR[constellation.code] ?? constellation.name
  return {
    constellation,
    name,
    aliases: [...new Set([name, constellation.name, constellation.code].map(normalizeSearch))],
  }
})

export function searchSky(index: SearchEntry[], query: string, limit = 12): SkySearchResult[] {
  const needle = normalizeSearch(query)
  if (!needle || limit <= 0) return []
  const matches: RankedResult[] = []

  for (const entry of index) {
    if (!entry.text.includes(needle)) continue
    // Keep the existing star-search ordering, including catalogue identifier aliases.
    const rank =
      entry.name === needle || entry.identifiers.includes(needle)
        ? 0
        : entry.name.startsWith(needle)
          ? 1
          : 2
    matches.push({ result: { kind: 'star', star: entry.star }, rank })
  }
  for (const { constellation, name, aliases } of constellationIndex) {
    if (!aliases.some((alias) => alias.includes(needle))) continue
    const rank = aliases.includes(needle)
      ? 0
      : aliases.some((alias) => alias.startsWith(needle))
        ? 1
        : 2
    matches.push({ result: { kind: 'constellation', constellation, name }, rank })
  }

  return matches
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      // At equal relevance, keep a constellation discoverable among its many stars.
      if (a.result.kind !== b.result.kind) return a.result.kind === 'constellation' ? -1 : 1
      if (a.result.kind === 'star' && b.result.kind === 'star') {
        return a.result.star.mag - b.result.star.mag
      }
      if (a.result.kind === 'constellation' && b.result.kind === 'constellation') {
        return a.result.name.localeCompare(b.result.name, 'fr')
      }
      return 0
    })
    .slice(0, limit)
    .map(({ result }) => result)
}
