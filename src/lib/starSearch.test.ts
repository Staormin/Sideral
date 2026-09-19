import { describe, expect, it } from 'vitest'
import {
  buildSearchIndex,
  normalizeSearch,
  searchResultIdentifier,
  searchStars,
} from './starSearch'
import { STAR_FIELDS, type Star } from '../types/catalog'

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

describe('star search', () => {
  const sirius = fixture({
    id: 32263,
    proper: 'Sirius',
    hip: 32349,
    hd: 48915,
    hr: 2491,
    mag: -1.44,
  })
  const betelgeuse = fixture({ id: 27919, proper: 'Betelgeuse', bf: '58Alp Ori', mag: 0.45 })
  const similar = fixture({ id: 999, proper: 'Sirius B', mag: 8.5 })
  const index = buildSearchIndex([similar, sirius, betelgeuse])

  it('normalizes accents, casing, catalogue whitespace and punctuation', () => {
    expect(normalizeSearch(' BÉTELGEUSE ')).toBe('betelgeuse')
    expect(searchStars(index, 'Bételgeuse')).toEqual([betelgeuse])
    for (const query of ['HIP 32349', 'hip-32349', 'HD48915', 'HR 2491', 'HYG 32263']) {
      expect(searchStars(index, query)).toEqual([sirius])
    }
    expect(searchStars(index, '58 Alp Ori')).toEqual([betelgeuse])
  })

  it('ranks exact matches first, limits results and handles empty or unknown queries', () => {
    expect(searchStars(index, 'Sirius')).toEqual([sirius, similar])
    expect(searchStars(index, 'Sirius', 1)).toEqual([sirius])
    expect(searchStars(index, '---')).toEqual([])
    expect(searchStars(index, 'absent')).toEqual([])
  })

  it('displays the matching catalogue alias rather than always repeating the HIP identifier', () => {
    const star = fixture({ id: 700001, hip: 700002, hd: 700003, hr: 700004 })
    expect(searchResultIdentifier(star, 'hd-700003')).toBe('HD 700003')
    expect(searchResultIdentifier(star, '700003')).toBe('HD 700003')
    expect(searchResultIdentifier(star, 'HR 700004')).toBe('HR 700004')
    expect(searchResultIdentifier(star, 'HYG 700001')).toBe('HYG 700001')
    expect(searchResultIdentifier(star, null)).toBe('HIP 700002')
    expect(searchResultIdentifier(star, 'name')).toBe('HIP 700002')
    expect(searchResultIdentifier(fixture({ id: 700001 }), '')).toBe('HYG 700001')
  })
})
