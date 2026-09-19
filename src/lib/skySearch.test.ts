import { describe, expect, it } from 'vitest'
import { STAR_FIELDS, type Star } from '../types/catalog'
import { CONSTELLATION_FIGURES } from './skyConstellations'
import { searchSky } from './skySearch'
import { buildSearchIndex, searchStars } from './starSearch'

function fixture(values: Partial<Star>): Star {
  return {
    ...Object.fromEntries(STAR_FIELDS.map((field) => [field, null])),
    id: 1,
    ra: 0,
    dec: 0,
    mag: 0,
    ...values,
  } as Star
}

describe('mixed sky search', () => {
  const sirius = fixture({
    id: 32263,
    proper: 'Sirius',
    hip: 32349,
    hd: 48915,
    hr: 2491,
    mag: -1.44,
  })
  const betelgeuse = fixture({ id: 27919, proper: 'Betelgeuse', bf: '58Alp Ori', mag: 0.45 })
  const rigel = fixture({ id: 24486, proper: 'Rigel', bf: '19Bet Ori', mag: 0.18 })
  const companion = fixture({ id: 999, proper: 'Sirius B', mag: 8.5 })
  const index = buildSearchIndex([companion, betelgeuse, sirius, rigel])

  it.each([
    ['Ori', 'Ori', 'Orion'],
    ['orion', 'Ori', 'Orion'],
    ['GRANDE OURSE', 'UMa', 'Grande Ourse'],
    ['Ursa Major', 'UMa', 'Grande Ourse'],
    ['u-ma', 'UMa', 'Grande Ourse'],
    ['Phénix', 'Phe', 'Phénix'],
    ['phenix', 'Phe', 'Phénix'],
    ['Phoenix', 'Phe', 'Phénix'],
    ['Couronne BOREALE', 'CrB', 'Couronne boréale'],
  ])('finds %s through French names, Latin names or codes', (query, code, name) => {
    expect(searchSky(index, query)[0]).toEqual({
      kind: 'constellation',
      constellation: CONSTELLATION_FIGURES.find((figure) => figure.code === code),
      name,
    })
  })

  it.each([
    'Sirius',
    'sir',
    'Bételgeuse',
    'HIP 32349',
    'hip-32349',
    'HD48915',
    'HR 2491',
    'HYG 32263',
    '58 Alp Ori',
    'Ori',
  ])('preserves the existing star aliases and ordering for %s', (query) => {
    const stars = searchSky(index, query, 100).flatMap((result) =>
      result.kind === 'star' ? [result.star] : [],
    )
    expect(stars).toEqual(searchStars(index, query, 100))
  })

  it('ranks exact catalogue identifiers and star names ahead of weaker matches', () => {
    expect(searchSky(index, 'HIP 32349', 1)).toEqual([{ kind: 'star', star: sirius }])
    expect(searchSky(index, 'Sirius', 1)).toEqual([{ kind: 'star', star: sirius }])
    const exact = fixture({ id: 10, proper: 'Grande', mag: 5 })
    const prefix = fixture({ id: 11, proper: 'Grande étoile', mag: -2 })
    const contains = fixture({ id: 12, proper: 'Une grande étoile', mag: -4 })
    const mixed = searchSky(buildSearchIndex([contains, prefix, exact]), 'Grande')
    expect(mixed).toEqual([
      { kind: 'star', star: exact },
      {
        kind: 'constellation',
        constellation: CONSTELLATION_FIGURES.find((figure) => figure.code === 'UMa'),
        name: 'Grande Ourse',
      },
      { kind: 'star', star: prefix },
      { kind: 'star', star: contains },
    ])
  })

  it('keeps constellations visible when many bright star names also match', () => {
    const crowded = buildSearchIndex(
      Array.from({ length: 20 }, (_, offset) =>
        fixture({ id: offset + 100, proper: `Orion ${offset}`, mag: offset / 10 - 2 }),
      ),
    )
    for (const query of ['Ori', 'Orion', 'Or']) {
      const results = searchSky(crowded, query)
      expect(results).toHaveLength(12)
      expect(results[0]).toMatchObject({ kind: 'constellation', constellation: { code: 'Ori' } })
      expect(searchSky(crowded, query, 1)).toEqual([results[0]])
    }
  })

  it('matches parts of constellation names and includes each figure only once', () => {
    expect(searchSky([], 'ourse')).toEqual([
      {
        kind: 'constellation',
        constellation: CONSTELLATION_FIGURES.find((figure) => figure.code === 'UMa'),
        name: 'Grande Ourse',
      },
      {
        kind: 'constellation',
        constellation: CONSTELLATION_FIGURES.find((figure) => figure.code === 'UMi'),
        name: 'Petite Ourse',
      },
    ])
    expect(searchSky([], 'Orion')).toHaveLength(1)
  })

  it('honors limits without suggesting results for empty or unknown queries', () => {
    for (const query of ['', '   ', '---', 'inexistante-xyz']) {
      expect(searchSky(index, query)).toEqual([])
    }
    expect(searchSky(index, 'Ori', 0)).toEqual([])
    expect(searchSky(index, 'Ori', -1)).toEqual([])
    expect(searchSky(index, 'Ori', 2)).toHaveLength(2)
  })
})
