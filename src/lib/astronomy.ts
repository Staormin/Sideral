import type { Star } from '../types/catalog'

const PARSEC_TO_LIGHT_YEAR = 3.261563777
const spectralTemperatures: Readonly<Record<string, number>> = {
  O: 35000,
  B: 20000,
  A: 8500,
  F: 6500,
  G: 5500,
  K: 4300,
  M: 3200,
}
const colorCache = new Map<number, string>()

export function starName(star: Star): string {
  return (
    star.proper ||
    star.bf ||
    (star.hip ? `HIP ${star.hip}` : null) ||
    (star.hd ? `HD ${star.hd}` : null) ||
    star.gl ||
    `HYG ${star.id}`
  )
}

/** Distances >=100000 pc are the catalogue's missing/dubious-parallax sentinel. */
export function distanceLy(starOrParsecs: Star | number | null): number | null {
  const parsecs =
    typeof starOrParsecs === 'object' && starOrParsecs !== null ? starOrParsecs.dist : starOrParsecs
  return parsecs !== null && Number.isFinite(parsecs) && parsecs > 0 && parsecs < 100000
    ? parsecs * PARSEC_TO_LIGHT_YEAR
    : null
}

/** Photometric approximation, not a measured temperature; no extinction correction. */
export function estimateTemperature(star: Pick<Star, 'ci'>): number | null {
  const bv = star.ci
  if (bv === null || !Number.isFinite(bv) || bv < -0.4 || bv > 2) return null
  // Ballesteros (2012), equation 14. See DATA_SOURCES.md.
  return Math.round(4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)))
}

function spectralTemperature(star: Pick<Star, 'spect'>): number | null {
  // Accept normal stellar classes; do not interpret white dwarf DA as an A star.
  const match = star.spect?.trim().match(/^(?:sd)?([OBAFGKM])/i)
  return match?.[1] ? (spectralTemperatures[match[1].toUpperCase()] ?? null) : null
}

export function colorSource(star: Pick<Star, 'ci' | 'spect'>): 'bv' | 'spectral' | 'unknown' {
  if (star.ci !== null && Number.isFinite(star.ci)) return 'bv'
  return spectralTemperature(star) !== null ? 'spectral' : 'unknown'
}

function gaussian(wavelength: number, center: number, left: number, right: number): number {
  const scaled = (wavelength - center) * (wavelength < center ? left : right)
  return Math.exp(-0.5 * scaled * scaled)
}

function blackbodyColor(temperature: number): string {
  // Quantization only affects display color, never stored scientific values.
  const kelvin = Math.round(temperature / 50) * 50
  const cached = colorCache.get(kelvin)
  if (cached) return cached
  let x = 0
  let y = 0
  let z = 0
  for (let wavelength = 380; wavelength <= 780; wavelength += 5) {
    // Relative Planck radiance. Common multiplicative constants cancel at normalization.
    const radiance = 1 / (wavelength ** 5 * Math.expm1(1.438776877e7 / (wavelength * kelvin)))
    // CIE 1931 fits: Wyman, Sloan & Shirley (2013), equation 4 / table 1.
    x +=
      radiance *
      (0.362 * gaussian(wavelength, 442, 0.0624, 0.0374) +
        1.056 * gaussian(wavelength, 599.8, 0.0264, 0.0323) -
        0.065 * gaussian(wavelength, 501.1, 0.049, 0.0382))
    y +=
      radiance *
      (0.821 * gaussian(wavelength, 568.8, 0.0213, 0.0247) +
        0.286 * gaussian(wavelength, 530.9, 0.0613, 0.0322))
    z +=
      radiance *
      (1.217 * gaussian(wavelength, 437, 0.0845, 0.0278) +
        0.681 * gaussian(wavelength, 459, 0.0385, 0.0725))
  }
  // CIE XYZ to linear sRGB, followed by gamut clipping and the sRGB transfer curve.
  const rgb = [
    Math.max(0, 3.2406 * x - 1.5372 * y - 0.4986 * z),
    Math.max(0, -0.9689 * x + 1.8758 * y + 0.0415 * z),
    Math.max(0, 0.0557 * x - 0.204 * y + 1.057 * z),
  ]
  const maximum = Math.max(...rgb)
  const hex = `#${rgb
    .map((channel) => {
      const linear = channel / maximum
      const srgb = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
      return Math.round(Math.min(1, Math.max(0, srgb)) * 255)
        .toString(16)
        .padStart(2, '0')
    })
    .join('')}`
  colorCache.set(kelvin, hex)
  return hex
}

/** A physical display approximation from B−V, with a labelled spectral fallback. */
export function starColor(star: Pick<Star, 'ci' | 'spect'>): string {
  // Outlying color indices saturate the palette instead of producing invalid temperatures.
  const temperature =
    star.ci !== null && Number.isFinite(star.ci)
      ? estimateTemperature({ ci: Math.min(2, Math.max(-0.4, star.ci)) })
      : spectralTemperature(star)
  return temperature === null ? '#e5e7eb' : blackbodyColor(temperature)
}

/** Radius in CSS pixels represents apparent brightness, never angular diameter. */
export function starRadius(magnitude: number, zoom = 1): number {
  const safeMagnitude = Number.isFinite(magnitude) ? magnitude : 12
  const safeZoom = Number.isFinite(zoom) ? Math.max(0.1, zoom) : 1
  return (
    Math.max(0.48, Math.min(4.8, 3.25 * 10 ** (-0.105 * safeMagnitude))) *
    Math.min(1.75, Math.max(0.85, safeZoom ** 0.12))
  )
}

export function formatRa(hours: number): string {
  if (!Number.isFinite(hours)) return '—'
  const deciseconds = Math.round((((hours % 24) + 24) % 24) * 36000) % 864000
  const h = Math.floor(deciseconds / 36000)
  const m = Math.floor((deciseconds % 36000) / 600)
  const s = (deciseconds % 600) / 10
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`
}

export function formatDec(degrees: number): string {
  if (!Number.isFinite(degrees) || Math.abs(degrees) > 90) return '—'
  const deciseconds = Math.round(Math.abs(degrees) * 36000)
  const d = Math.floor(deciseconds / 36000)
  const m = Math.floor((deciseconds % 36000) / 600)
  const s = (deciseconds % 600) / 10
  const sign = degrees < 0 || Object.is(degrees, -0) ? '−' : '+'
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${s.toFixed(1).padStart(4, '0')}″`
}
