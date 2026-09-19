/** Original HYG 4.1 fields. Missing values are explicit nulls. */
export interface Star {
  id: number
  hip: number | null
  hd: number | null
  hr: number | null
  gl: string | null
  bf: string | null
  proper: string | null
  /** Right ascension, hours, J2000.0. */
  ra: number
  /** Declination, degrees, J2000.0. */
  dec: number
  /** Parsecs. HYG's >=100000 sentinel is preserved; use distanceLy to display. */
  dist: number | null
  pmra: number | null
  pmdec: number | null
  rv: number | null
  mag: number
  absmag: number | null
  spect: string | null
  ci: number | null
  x: number | null
  y: number | null
  z: number | null
  vx: number | null
  vy: number | null
  vz: number | null
  rarad: number | null
  decrad: number | null
  pmrarad: number | null
  pmdecrad: number | null
  bayer: string | null
  flam: string | null
  con: string | null
  comp: number | null
  comp_primary: number | null
  base: string | null
  lum: number | null
  var: string | null
  var_min: number | null
  var_max: number | null
}

export interface CatalogMetadata {
  name: string
  version: string
  count: number
  epoch: string
  license: string
  licenseUrl: string
  source: string
  revision: string
  sourceSha256: string
  excludedSun: number
  fields: number
}

export interface Catalog {
  stars: Star[]
  metadata: CatalogMetadata
}

/** Schema order is shared by the compact JSON document and its runtime parser. */
export const STAR_FIELDS = [
  'id',
  'hip',
  'hd',
  'hr',
  'gl',
  'bf',
  'proper',
  'ra',
  'dec',
  'dist',
  'pmra',
  'pmdec',
  'rv',
  'mag',
  'absmag',
  'spect',
  'ci',
  'x',
  'y',
  'z',
  'vx',
  'vy',
  'vz',
  'rarad',
  'decrad',
  'pmrarad',
  'pmdecrad',
  'bayer',
  'flam',
  'con',
  'comp',
  'comp_primary',
  'base',
  'lum',
  'var',
  'var_min',
  'var_max',
] as const satisfies readonly (keyof Star)[]
