import { bbox } from '@turf/turf'
import type { LngLatBoundsLike, StyleSpecification } from 'maplibre-gl'
import fezBoundary from '../data/fez_boundary.json'

// Klaipėdos LEZ riba iš OpenStreetMap (relation 10031481).
export const FEZ_BOUNDARY = fezBoundary as GeoJSON.FeatureCollection
export const FEZ_BOUNDS = bbox(FEZ_BOUNDARY) as [number, number, number, number] satisfies LngLatBoundsLike
export const FEZ_FIT_PADDING = 60

// Priartinimo ribos: 19 – atskiri pastatai dar ryškūs; 11 – matosi visa Klaipėda.
export const MIN_ZOOM = 11
export const MAX_ZOOM = 19

export const VIEW_2D = { pitch: 0, bearing: 0 }
export const VIEW_3D = { pitch: 60, bearing: -20 }

export type BasemapId = 'dark' | 'light' | 'color' | 'satellite'

export interface Basemap {
  id: BasemapId
  label: string
  style: string | StyleSpecification
  // 3D pastatų ir LEZ ribos spalvos, kad matytųsi ant konkretaus pagrindo.
  buildingColor: string
  boundaryColor: string
  // Pagrindo raiškos riba; jei nenurodyta – MAX_ZOOM.
  maxZoom?: number
}

const SATELLITE_MAX_ZOOM = 18

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  // Šriftai mūsų sluoksnių etiketėms (pastočių pavadinimai) – tie patys kaip OpenFreeMap stiliuose.
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      // Klaipėdoje Esri vaizdai yra tik iki z18 – aukščiau grąžina „Map data not yet available“.
      maxzoom: SATELLITE_MAX_ZOOM,
      attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      // Esri vaizdai kiek blankūs – paryškinam.
      paint: { 'raster-contrast': 0.15, 'raster-saturation': 0.2, 'raster-brightness-min': 0.02 },
    },
  ],
}

// OpenFreeMap: nemokami OSM vektoriniai tile'ai, API rakto nereikia.
export const BASEMAPS: Basemap[] = [
  { id: 'dark', label: 'Tamsus', style: 'https://tiles.openfreemap.org/styles/dark', buildingColor: '#334155', boundaryColor: '#e2e8f0' },
  { id: 'light', label: 'Šviesus', style: 'https://tiles.openfreemap.org/styles/positron', buildingColor: '#cbd5e1', boundaryColor: '#2563eb' },
  { id: 'color', label: 'Spalvotas', style: 'https://tiles.openfreemap.org/styles/liberty', buildingColor: '#d6d3d1', boundaryColor: '#2563eb' },
  { id: 'satellite', label: 'Palydovas', style: SATELLITE_STYLE, buildingColor: '#94a3b8', boundaryColor: '#facc15', maxZoom: SATELLITE_MAX_ZOOM },
]

export const DEFAULT_BASEMAP: BasemapId = 'dark'
