import { describe, expect, it } from 'vitest'
import {
  colorSource,
  distanceLy,
  estimateTemperature,
  formatDec,
  formatRa,
  starColor,
  starRadius,
} from './astronomy'

describe('astronomical display conventions', () => {
  it('formats equatorial coordinates with carry and the 24-hour wrap', () => {
    expect(formatRa(6.752481)).toBe('06h 45m 08.9s')
    expect(formatDec(-16.716116)).toBe('−16° 42′ 58.0″')
    expect(formatRa(23.9999999)).toBe('00h 00m 00.0s')
    expect(formatRa(-1)).toBe('23h 00m 00.0s')
    expect(formatDec(89.9999999)).toBe('+90° 00′ 00.0″')
    expect(formatDec(-0)).toBe('−00° 00′ 00.0″')
    expect(formatDec(91)).toBe('—')
  })

  it('never presents missing or dubious HYG parallax as a distance', () => {
    expect(distanceLy(2.6371)).toBeCloseTo(8.60107, 5)
    for (const missing of [null, 0, -1, 100000, 100001, Number.NaN]) {
      expect(distanceLy(missing)).toBeNull()
    }
  })

  it('estimates temperature only inside the supported photometric range', () => {
    expect(estimateTemperature({ ci: 0.656 })).toBeCloseTo(5756, -1)
    expect(estimateTemperature({ ci: 0 })).toBeGreaterThan(10000)
    expect(estimateTemperature({ ci: 1.8 })).toBeLessThan(3500)
    expect(estimateTemperature({ ci: null })).toBeNull()
    expect(estimateTemperature({ ci: 5.46 })).toBeNull()
    expect(estimateTemperature({ ci: -1 })).toBeNull()
  })

  it('renders hot stars blue and cool stars orange using valid display colors', () => {
    const blue = starColor({ ci: -0.2, spect: 'B2V' })
    const orange = starColor({ ci: 1.8, spect: 'M2Iab' })
    const red = (hex: string) => Number.parseInt(hex.slice(1, 3), 16)
    const blueChannel = (hex: string) => Number.parseInt(hex.slice(5, 7), 16)
    expect(blue).toMatch(/^#[0-9a-f]{6}$/)
    expect(orange).toMatch(/^#[0-9a-f]{6}$/)
    expect(blueChannel(blue)).toBeGreaterThan(red(blue))
    expect(red(orange)).toBeGreaterThan(blueChannel(orange))
    expect(starColor({ ci: 5.46, spect: null })).toBe(starColor({ ci: 2, spect: null }))
  })

  it('distinguishes measured color indices, spectral approximation, and no information', () => {
    expect(colorSource({ ci: 0, spect: null })).toBe('bv')
    expect(colorSource({ ci: null, spect: 'K2III' })).toBe('spectral')
    expect(colorSource({ ci: null, spect: 'DA' })).toBe('unknown')
    expect(colorSource({ ci: null, spect: null })).toBe('unknown')
    expect(starColor({ ci: null, spect: null })).toBe('#e5e7eb')
    expect(starColor({ ci: null, spect: 'K2III' })).not.toBe('#e5e7eb')
  })

  it('keeps faint stars visible while encoding the magnitude ordering', () => {
    expect(starRadius(-1.44)).toBeGreaterThan(starRadius(3))
    expect(starRadius(3)).toBeGreaterThan(starRadius(8))
    expect(starRadius(22)).toBeGreaterThan(0)
    expect(starRadius(5, 10)).toBeGreaterThan(starRadius(5, 1))
  })
})
