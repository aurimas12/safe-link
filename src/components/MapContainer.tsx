import { Box, Crosshair, Map as MapIcon } from 'lucide-react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'
import {
  BASEMAPS,
  DEFAULT_BASEMAP,
  FEZ_BOUNDARY,
  FEZ_BOUNDS,
  FEZ_FIT_PADDING,
  MAX_ZOOM,
  MIN_ZOOM,
  VIEW_2D,
  VIEW_3D,
  type Basemap,
  type BasemapId,
} from '../map/config'
import { DEFAULT_VISIBLE_ESO, ESO_DATA_URL, ESO_GROUPS, ESO_SOURCE, describeEsoFeature } from '../map/eso'
import LayerMenu from './LayerMenu'

// Vite perkelia maplibre-gl į .vite/deps, kur jo worker failo nėra – nurodom sukompiliuotą worker'į patys.
maplibregl.setWorkerUrl(workerUrl)

const BUILDINGS_3D = 'buildings-3d'
const FEZ_SOURCE = 'fez-boundary'

const LAYER_GROUPS = ESO_GROUPS
// Plotai → linijos → taškai → etiketės: taškai (pastotės) turi būti virš kabelių, kad juos būtų galima paspausti.
const TYPE_ORDER: Record<string, number> = { fill: 0, line: 1, circle: 2, symbol: 3 }
const ORDERED_LAYERS = LAYER_GROUPS.flatMap((group) => group.layers.map((layer) => ({ group, layer }))).sort(
  (a, b) => (TYPE_ORDER[a.layer.type] ?? 0) - (TYPE_ORDER[b.layer.type] ?? 0),
)
// Sluoksniai, ant kurių paspaudus rodomas objekto aprašas (etiketės nepaspaudžiamos).
const CLICKABLE_LAYERS = LAYER_GROUPS.flatMap((g) => g.layers)
  .filter((l) => l.type !== 'symbol')
  .map((l) => l.id)

function getBasemap(id: BasemapId): Basemap {
  return BASEMAPS.find((b) => b.id === id)!
}

// Mūsų sluoksniai dingsta po setStyle(), todėl juos pridedam po kiekvieno stiliaus užkrovimo.
function addOverlays(
  map: maplibregl.Map,
  basemap: Basemap,
  is3d: boolean,
  visibleGroups: Set<string>,
) {
  // Liberty stilius turi savo 3D pastatus – paliekam tik savuosius, kad juos valdytų 2D/3D mygtukas.
  if (map.getLayer('building-3d')) map.removeLayer('building-3d')

  if (map.getSource('openmaptiles')) {
    map.addLayer({
      id: BUILDINGS_3D,
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      layout: { visibility: is3d ? 'visible' : 'none' },
      paint: {
        'fill-extrusion-color': basemap.buildingColor,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.85,
      },
    })
  }

  map.addSource(FEZ_SOURCE, { type: 'geojson', data: FEZ_BOUNDARY })
  map.addLayer({
    id: 'fez-boundary-fill',
    type: 'fill',
    source: FEZ_SOURCE,
    paint: { 'fill-color': basemap.boundaryColor, 'fill-opacity': 0.06 },
  })
  map.addLayer({
    id: 'fez-boundary-line',
    type: 'line',
    source: FEZ_SOURCE,
    paint: { 'line-color': basemap.boundaryColor, 'line-width': 2, 'line-dasharray': [3, 2] },
  })

  map.addSource(ESO_SOURCE, { type: 'geojson', data: ESO_DATA_URL })
  for (const { group, layer } of ORDERED_LAYERS) {
    map.addLayer({ ...layer, layout: { ...layer.layout, visibility: visibleGroups.has(group.id) ? 'visible' : 'none' } })
  }
}

// Popup turinys kuriamas per DOM (textContent), kad duomenų tekstas niekada nebūtų interpretuojamas kaip HTML.
function popupContent(feature: maplibregl.MapGeoJSONFeature): HTMLElement {
  const { title, rows } = describeEsoFeature(feature.properties)
  const root = document.createElement('div')
  root.className = 'infra-popup'
  const h = document.createElement('div')
  h.className = 'infra-popup-title'
  h.textContent = title
  root.append(h)
  const dl = document.createElement('dl')
  for (const [k, v] of rows) {
    const dt = document.createElement('dt')
    dt.textContent = k
    const dd = document.createElement('dd')
    dd.textContent = v
    dl.append(dt, dd)
  }
  root.append(dl)
  const note = document.createElement('div')
  note.className = 'infra-popup-note'
  note.textContent = 'Šaltinis: AB „Energijos skirstymo operatorius“ (atviri duomenys)'
  root.append(note)
  return root
}

export default function MapContainer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [is3d, setIs3d] = useState(false)
  const [basemapId, setBasemapId] = useState<BasemapId>(DEFAULT_BASEMAP)
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(
    () => new Set(DEFAULT_VISIBLE_ESO),
  )
  // 'style.load' klausytojas sukuriamas vieną kartą, todėl dabartines reikšmes skaito per ref.
  const stateRef = useRef({ is3d, basemapId, visibleGroups })
  useEffect(() => {
    stateRef.current = { is3d, basemapId, visibleGroups }
  }, [is3d, basemapId, visibleGroups])
  const appliedBasemap = useRef(basemapId)

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: getBasemap(appliedBasemap.current).style,
      // Visada užsikrauna pritaikytas prie LEZ teritorijos, nepriklausomai nuo ekrano dydžio.
      bounds: FEZ_BOUNDS,
      fitBoundsOptions: { padding: FEZ_FIT_PADDING },
      minZoom: MIN_ZOOM,
      maxZoom: getBasemap(appliedBasemap.current).maxZoom ?? MAX_ZOOM,
      ...VIEW_2D,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('style.load', () => {
      const { basemapId, is3d, visibleGroups } = stateRef.current
      addOverlays(map, getBasemap(basemapId), is3d, visibleGroups)
    })
    // Sluoksnio klausytojai tikrina sluoksnį įvykio metu, todėl veikia ir po setStyle().
    map.on('click', CLICKABLE_LAYERS, (e) => {
      const feature = e.features?.[0]
      if (!feature) return
      new maplibregl.Popup({ maxWidth: '300px' }).setLngLat(e.lngLat).setDOMContent(popupContent(feature)).addTo(map)
    })
    map.on('mouseenter', CLICKABLE_LAYERS, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', CLICKABLE_LAYERS, () => (map.getCanvas().style.cursor = ''))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current || appliedBasemap.current === basemapId) return
    appliedBasemap.current = basemapId
    const basemap = getBasemap(basemapId)
    // Palydovas neturi vaizdų virš z18 – neleidžiam priartinti tiek, kad vaizdas išsilietų.
    mapRef.current.setMaxZoom(basemap.maxZoom ?? MAX_ZOOM)
    mapRef.current.setStyle(basemap.style)
  }, [basemapId])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer(BUILDINGS_3D)) {
      map.setLayoutProperty(BUILDINGS_3D, 'visibility', is3d ? 'visible' : 'none')
    }
    map.easeTo({ ...(is3d ? VIEW_3D : VIEW_2D), duration: 800 })
  }, [is3d])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const group of LAYER_GROUPS) {
      for (const layer of group.layers) {
        if (map.getLayer(layer.id)) {
          map.setLayoutProperty(layer.id, 'visibility', visibleGroups.has(group.id) ? 'visible' : 'none')
        }
      }
    }
  }, [visibleGroups])

  const toggleGroup = (id: string) =>
    setVisibleGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const recenter = () => {
    mapRef.current?.fitBounds(FEZ_BOUNDS, { padding: FEZ_FIT_PADDING, ...(is3d ? VIEW_3D : VIEW_2D), duration: 800 })
  }

  const control =
    'flex items-center gap-2 rounded-md border border-slate-700 bg-panel/80 px-3 py-1.5 text-sm text-slate-200 backdrop-blur hover:bg-panel'

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute left-3 top-3 flex flex-col items-start gap-2 pr-14">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setIs3d((v) => !v)} className={control}>
            {is3d ? <MapIcon size={16} /> : <Box size={16} />}
            {is3d ? '2D' : '3D'}
          </button>
          <button onClick={recenter} className={control} title="Centruoti į LEZ teritoriją">
            <Crosshair size={16} />
            LEZ
          </button>
          <div className="flex overflow-hidden rounded-md border border-slate-700 bg-panel/80 text-sm backdrop-blur">
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                onClick={() => setBasemapId(b.id)}
                className={
                  b.id === basemapId
                    ? 'bg-status-action px-3 py-1.5 text-white'
                    : 'px-3 py-1.5 text-slate-300 hover:bg-slate-700/60'
                }
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <LayerMenu visible={visibleGroups} onToggle={toggleGroup} />
      </div>
    </div>
  )
}
