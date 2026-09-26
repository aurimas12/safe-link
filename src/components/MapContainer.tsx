import { Box, Crosshair, Loader2, Map as MapIcon, TriangleAlert, X } from 'lucide-react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Fragment, useEffect, useRef, useState } from 'react'
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
import {
  AFFECTED_LAYERS,
  AREA_BUILDINGS_URL,
  AREA_GROUP,
  AREA_SOURCE,
  BUILDINGS_DATA,
  BUILDINGS_GROUP,
  BUILDINGS_SOURCE,
  HIGHLIGHT_LAYERS,
  SELECTED_LAYERS,
  byIds,
  describeBuilding,
  describeImpact,
} from '../map/buildings'
import {
  EMPTY,
  GRAPH_GROUP,
  GRAPH_SELECTED_LAYERS,
  GRAPH_SELECTED_SOURCE,
  GRAPH_SOURCE,
  describeDependencies,
  downstream,
  graphData,
  loadGraph,
  upstream,
  type Graph,
} from '../map/graph'
import {
  ETA_NOTE,
  SHELTERS_DATA,
  SHELTERS_GROUP,
  SHELTERS_SOURCE,
  STATIONS_DATA,
  STATIONS_GROUP,
  STATIONS_SOURCE,
  describeBuildingEmergency,
  describeShelter,
  describeStation,
} from '../map/emergency'
import { DEFAULT_VISIBLE_ESO, ESO_DATA_URL, ESO_GROUPS, ESO_SOURCE, describeEsoFeature } from '../map/eso'
import {
  DEFAULT_VISIBLE_WATER,
  WATER_GROUPS,
  WATER_GROUP_IDS,
  WATER_SOURCES,
  WATER_VECTOR_MIN_ZOOM,
  WATER_VECTOR_SOURCES,
  describeWaterFeature,
  loadWaterGroup,
  vectorSourceId,
} from '../map/water'
import LayerMenu from './LayerMenu'

// Vite moves maplibre-gl into .vite/deps where its worker file is missing – point MapLibre to the bundled worker.
maplibregl.setWorkerUrl(workerUrl)

const BUILDINGS_3D = 'buildings-3d'
const FEZ_SOURCE = 'fez-boundary'
const BUILDING_SOURCES = new Set([BUILDINGS_SOURCE, AREA_SOURCE])

// Buildings at the bottom, water under ESO – the power grid stays on top.
const LAYER_GROUPS = [AREA_GROUP, BUILDINGS_GROUP, GRAPH_GROUP, ...WATER_GROUPS, ...ESO_GROUPS, SHELTERS_GROUP, STATIONS_GROUP]
// Rasters → fills → lines → points → labels: points (substations, hydrants) must stay above lines to be clickable.
const TYPE_ORDER: Record<string, number> = { raster: -1, fill: 0, line: 1, circle: 2, symbol: 3 }
const ORDERED_LAYERS = LAYER_GROUPS.flatMap((group) => group.layers.map((layer) => ({ group, layer }))).sort(
  (a, b) => (TYPE_ORDER[a.layer.type] ?? 0) - (TYPE_ORDER[b.layer.type] ?? 0),
)
// Layers that open the info panel when clicked (labels, rasters and graph routes are not clickable).
const CLICKABLE_LAYERS = LAYER_GROUPS.flatMap((g) => g.layers)
  .filter((l) => l.type !== 'symbol' && l.type !== 'raster' && !l.id.startsWith('lez-graph'))
  .map((l) => l.id)

// ESO layer ids as used in graph node ids (eso/<layer>/<OBJECTID>).
const ESO_LAYER_IDS: Record<string, number> = { substation: 6, substation_important: 7, substation_hv: 8 }

function getBasemap(id: BasemapId): Basemap {
  return BASEMAPS.find((b) => b.id === id)!
}

// Our layers are dropped by setStyle(), so they are added after every style load.
function addOverlays(map: maplibregl.Map, basemap: Basemap, is3d: boolean, visibleGroups: Set<string>, graph: Graph | null) {
  // The liberty style has its own 3D buildings – keep only ours so the 2D/3D button controls them.
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
  map.addLayer({ id: 'fez-boundary-fill', type: 'fill', source: FEZ_SOURCE, paint: { 'fill-color': basemap.boundaryColor, 'fill-opacity': 0.06 } })
  map.addLayer({
    id: 'fez-boundary-line',
    type: 'line',
    source: FEZ_SOURCE,
    paint: { 'line-color': basemap.boundaryColor, 'line-width': 2, 'line-dasharray': [3, 2] },
  })

  map.addSource(BUILDINGS_SOURCE, { type: 'geojson', data: BUILDINGS_DATA })
  map.addSource(AREA_SOURCE, { type: 'geojson', data: AREA_BUILDINGS_URL })
  map.addSource(GRAPH_SOURCE, { type: 'geojson', data: graph ? graphData(graph) : EMPTY })
  map.addSource(GRAPH_SELECTED_SOURCE, { type: 'geojson', data: EMPTY })
  map.addSource(STATIONS_SOURCE, { type: 'geojson', data: STATIONS_DATA })
  map.addSource(SHELTERS_SOURCE, { type: 'geojson', data: SHELTERS_DATA })
  map.addSource(ESO_SOURCE, { type: 'geojson', data: ESO_DATA_URL })
  for (const [id, source] of WATER_SOURCES) map.addSource(id, source)
  for (const { group, layer } of ORDERED_LAYERS) {
    map.addLayer({ ...layer, layout: { ...layer.layout, visibility: visibleGroups.has(group.id) ? 'visible' : 'none' } })
  }
  // Highlights: affected buildings above building fills; selected routes above lines but below points.
  const firstLine = ORDERED_LAYERS.find(({ layer }) => layer.type === 'line')?.layer.id
  const firstPoint = ORDERED_LAYERS.find(({ layer }) => layer.type === 'circle')?.layer.id
  for (const layer of HIGHLIGHT_LAYERS) map.addLayer(layer, layer.type === 'fill' ? firstLine : firstPoint)
  for (const layer of GRAPH_SELECTED_LAYERS) map.addLayer(layer, firstPoint)
}

interface FeatureInfo {
  title: string
  rows: [string, string][]
  source: string
}

// What was clicked: a building (shows what it depends on) or a network node (shows what depends on it).
type Selection = { kind: 'building'; source: string; id: number } | { kind: 'node'; nodeId: string } | null

function graphNodeOf(feature: maplibregl.MapGeoJSONFeature): string | null {
  const p = feature.properties
  if (feature.source === ESO_SOURCE && ESO_LAYER_IDS[p.layer] != null) return `eso/${ESO_LAYER_IDS[p.layer]}/${p.OBJECTID}`
  if (WATER_VECTOR_SOURCES.has(feature.source) && p._service === 'V_sistema_ViesamNaudojimui') {
    if (p._layerId === 3) return `water/valve/${p.OBJECTID}`
    if (p._layerId === 5 && String(p.Class ?? '').startsWith('V Mag.')) return `water/pipe/${p.OBJECTID}`
  }
  return null
}

// Info panel content for the clicked object (React renders text safely, no HTML interpretation).
function describeFeature(feature: maplibregl.MapGeoJSONFeature, graph: Graph | null): FeatureInfo {
  const p = feature.properties
  if (BUILDING_SOURCES.has(feature.source)) {
    const id = `building/${p.OBJECTID}`
    const building = describeBuilding(p, feature.source === BUILDINGS_SOURCE)
    return {
      title: building.title,
      rows: [
        ...building.rows,
        ...(graph ? describeDependencies(graph, id) : [['Dependencies', 'loading the graph…'] as [string, string]]),
        ...describeBuildingEmergency(id),
      ],
      source:
        'building: GRPK (NŽT); purpose: Registrų centras; company and address: OpenStreetMap; ' +
        'employees: Sodra; finances: Registrų centras (JAR); shelters: PAGD; ' +
        'power and water links: derived from ESO and Klaipėdos vanduo network geometry (switch and valve states unknown). ' +
        ETA_NOTE,
    }
  }
  if (feature.source === STATIONS_SOURCE) return { ...describeStation(p), source: 'OpenStreetMap' }
  if (feature.source === SHELTERS_SOURCE) return { ...describeShelter(p), source: 'PAGD open data (data.gov.lt)' }

  const base = WATER_VECTOR_SOURCES.has(feature.source)
    ? { ...describeWaterFeature(p), source: 'AB „Klaipėdos vanduo“ (public data, live)' }
    : { ...describeEsoFeature(p), source: 'AB „Energijos skirstymo operatorius“ (open data)' }
  // Network node: add its influence – which buildings depend on it.
  const nodeId = graphNodeOf(feature)
  const node = nodeId ? graph?.node.get(nodeId) : undefined
  if (node?.impact) {
    base.rows = [...describeImpact(node.impact, node.affects ?? []), ...base.rows]
    base.source += '; influence: dependency graph (shortest cable / pipe routes)'
  } else if (nodeId && graph) {
    base.rows = [['Buildings depending on it', 'none in the graph area'], ...base.rows]
  }
  return base
}

// The FEZ is centred in the free part of the screen – the menu is on the left.
function fezPadding(): maplibregl.PaddingOptions {
  const menu = window.innerWidth >= 900 ? 320 : 0
  return { top: FEZ_FIT_PADDING, bottom: FEZ_FIT_PADDING, right: FEZ_FIT_PADDING, left: FEZ_FIT_PADDING + menu }
}

export default function MapContainer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [is3d, setIs3d] = useState(false)
  const [basemapId, setBasemapId] = useState<BasemapId>(DEFAULT_BASEMAP)
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(
    () => new Set([BUILDINGS_GROUP.id, AREA_GROUP.id, STATIONS_GROUP.id, ...DEFAULT_VISIBLE_ESO, ...DEFAULT_VISIBLE_WATER]),
  )
  const [waterLoading, setWaterLoading] = useState(0)
  const [waterError, setWaterError] = useState<string | null>(null)
  const refreshWaterRef = useRef<() => void>(() => {})
  const [selected, setSelected] = useState<FeatureInfo | null>(null)
  const clearSelectionRef = useRef<() => void>(() => {})
  const [graphError, setGraphError] = useState(false)
  // Highlight the supply routes (cables / pipes) of the clicked building or network node.
  const [showRoutes, setShowRoutes] = useState(true)
  const applySelectionRef = useRef<() => void>(() => {})
  // The 'style.load' listener is created once, so it reads current values through a ref.
  const stateRef = useRef<{
    is3d: boolean
    basemapId: BasemapId
    visibleGroups: Set<string>
    showRoutes: boolean
    graph: Graph | null
  }>({ is3d, basemapId, visibleGroups, showRoutes, graph: null })
  useEffect(() => {
    stateRef.current = { ...stateRef.current, is3d, basemapId, visibleGroups, showRoutes }
  }, [is3d, basemapId, visibleGroups, showRoutes])
  // Switching routes on / off updates the current selection at once.
  useEffect(() => applySelectionRef.current(), [showRoutes])
  const appliedBasemap = useRef(basemapId)

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: getBasemap(appliedBasemap.current).style,
      // Always opens fitted to the FEZ, whatever the screen size.
      bounds: FEZ_BOUNDS,
      fitBoundsOptions: { padding: fezPadding() },
      minZoom: MIN_ZOOM,
      maxZoom: getBasemap(appliedBasemap.current).maxZoom ?? MAX_ZOOM,
      ...VIEW_2D,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('style.load', () => {
      const { basemapId, is3d, visibleGroups, graph } = stateRef.current
      addOverlays(map, getBasemap(basemapId), is3d, visibleGroups, graph)
    })

    // --- selection and its highlights ---
    let selection: Selection = null
    const applySelection = () => {
      const graph = stateRef.current.graph
      for (const [source, layer] of Object.entries(SELECTED_LAYERS)) {
        if (!map.getLayer(layer)) continue
        const id = selection?.kind === 'building' && selection.source === source ? [selection.id] : []
        map.setFilter(layer, byIds(id))
      }
      // Influence: buildings depending on the selected network node.
      const affected = selection?.kind === 'node' ? (graph?.node.get(selection.nodeId)?.affects ?? []) : []
      const affectedIds = affected.map((b) => Number(b.slice('building/'.length)))
      const lezIds = new Set(BUILDINGS_DATA.features.map((f) => f.properties!.OBJECTID as number))
      for (const [source, layer] of Object.entries(AFFECTED_LAYERS)) {
        if (!map.getLayer(layer)) continue
        const ids = affectedIds.filter((id) => lezIds.has(id) === (source === BUILDINGS_SOURCE))
        map.setFilter(layer, byIds(ids))
      }
      // Routes: what a building depends on (upstream) or what a node feeds (downstream).
      let routes: GeoJSON.FeatureCollection = EMPTY
      if (stateRef.current.showRoutes) {
        if (graph && selection?.kind === 'building') routes = upstream(graph, `building/${selection.id}`)
        if (graph && selection?.kind === 'node') routes = downstream(graph, selection.nodeId)
      }
      ;(map.getSource(GRAPH_SELECTED_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(routes)
    }
    // After a basemap change the layers are recreated – restore the selection.
    map.on('style.load', applySelection)
    applySelectionRef.current = applySelection
    clearSelectionRef.current = () => {
      selection = null
      applySelection()
    }

    // --- dependency graph (loaded in the background) ---
    loadGraph()
      .then((graph) => {
        stateRef.current = { ...stateRef.current, graph }
        ;(map.getSource(GRAPH_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(graphData(graph))
        applySelection()
      })
      .catch((err: unknown) => {
        console.warn(err)
        setGraphError(true)
      })

    // Click priority: points (substations, hydrants) → building → lines. Clicking inside a building always
    // opens the building, even when a cable or pipe runs across it.
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: CLICKABLE_LAYERS.filter((id) => map.getLayer(id)) })
      const feature =
        features.find((f) => f.layer.type === 'circle') ?? features.find((f) => BUILDING_SOURCES.has(f.source)) ?? features[0]
      // Empty spot – clear the selection.
      setSelected(feature ? describeFeature(feature, stateRef.current.graph) : null)
      // The right panel (w-80 + gaps ≈ 400 px) must not cover the clicked object – pan the map.
      const panelLeft = map.getCanvas().clientWidth - 400
      if (feature && e.point.x > panelLeft) map.panBy([e.point.x - panelLeft + 40, 0], { duration: 400 })
      if (feature && BUILDING_SOURCES.has(feature.source)) {
        selection = { kind: 'building', source: feature.source, id: Number(feature.properties.OBJECTID) }
      } else {
        const nodeId = feature ? graphNodeOf(feature) : null
        selection = nodeId ? { kind: 'node', nodeId } : null
      }
      applySelection()
    })
    map.on('mouseenter', CLICKABLE_LAYERS, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', CLICKABLE_LAYERS, () => (map.getCanvas().style.cursor = ''))

    // Water network objects are loaded live from Klaipėdos vanduo for the visible area only, when zoomed in.
    const waterRequests = new Map<string, AbortController>()
    let waterTimer: ReturnType<typeof setTimeout> | undefined
    const refreshWater = () => {
      clearTimeout(waterTimer)
      waterTimer = setTimeout(() => {
        if (map.getZoom() < WATER_VECTOR_MIN_ZOOM) return
        const b = map.getBounds()
        const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
        for (const id of WATER_GROUP_IDS) {
          if (!stateRef.current.visibleGroups.has(id)) continue
          waterRequests.get(id)?.abort()
          const request = new AbortController()
          waterRequests.set(id, request)
          setWaterLoading((n) => n + 1)
          loadWaterGroup(id, bbox, request.signal)
            .then((data) => {
              ;(map.getSource(vectorSourceId(id)) as maplibregl.GeoJSONSource | undefined)?.setData(data)
              setWaterError(null)
            })
            .catch((err: unknown) => {
              if (err instanceof DOMException && err.name === 'AbortError') return
              console.warn(err)
              setWaterError('Could not load Klaipėdos vanduo data')
            })
            .finally(() => setWaterLoading((n) => n - 1))
        }
      }, 250)
    }
    refreshWaterRef.current = refreshWater
    map.on('moveend', refreshWater)
    // After setStyle() the vector sources are empty – reload.
    map.on('style.load', refreshWater)

    mapRef.current = map
    return () => {
      clearTimeout(waterTimer)
      for (const request of waterRequests.values()) request.abort()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current || appliedBasemap.current === basemapId) return
    appliedBasemap.current = basemapId
    const basemap = getBasemap(basemapId)
    // Satellite imagery stops at z18 – do not allow zooming in so far that it blurs.
    mapRef.current.setMaxZoom(basemap.maxZoom ?? MAX_ZOOM)
    mapRef.current.setStyle(basemap.style)
  }, [basemapId])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer(BUILDINGS_3D)) map.setLayoutProperty(BUILDINGS_3D, 'visibility', is3d ? 'visible' : 'none')
    map.easeTo({ ...(is3d ? VIEW_3D : VIEW_2D), duration: 800 })
  }, [is3d])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const group of LAYER_GROUPS) {
      for (const layer of group.layers) {
        if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', visibleGroups.has(group.id) ? 'visible' : 'none')
      }
    }
    // A water layer was switched on – load the objects of the visible area.
    refreshWaterRef.current()
  }, [visibleGroups])

  const toggleGroup = (id: string) =>
    setVisibleGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const recenter = () => {
    mapRef.current?.fitBounds(FEZ_BOUNDS, { padding: fezPadding(), ...(is3d ? VIEW_3D : VIEW_2D), duration: 800 })
  }

  const control =
    'flex items-center gap-2 rounded-md border border-slate-700 bg-panel/80 px-3 py-1.5 text-sm text-slate-200 backdrop-blur hover:bg-panel'
  const status = waterError ?? (graphError ? 'Could not load the dependency graph' : null)

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute left-3 top-3 flex flex-col items-start gap-2 pr-14">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setIs3d((v) => !v)} className={control}>
            {is3d ? <MapIcon size={16} /> : <Box size={16} />}
            {is3d ? '2D' : '3D'}
          </button>
          <button onClick={recenter} className={control} title="Centre on the FEZ">
            <Crosshair size={16} />
            FEZ
          </button>
          <div className="flex overflow-hidden rounded-md border border-slate-700 bg-panel/80 text-sm backdrop-blur">
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                onClick={() => setBasemapId(b.id)}
                className={b.id === basemapId ? 'bg-status-action px-3 py-1.5 text-white' : 'px-3 py-1.5 text-slate-300 hover:bg-slate-700/60'}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <LayerMenu
          visible={visibleGroups}
          onToggle={toggleGroup}
          showRoutes={showRoutes}
          onToggleRoutes={() => setShowRoutes((v) => !v)}
        />
      </div>
      {selected && (
        <aside className="absolute right-14 top-3 max-h-[calc(100%-5rem)] w-80 max-w-[calc(100vw-5rem)] overflow-y-auto rounded-md border border-slate-700 bg-panel/95 text-sm text-slate-200 shadow-xl backdrop-blur">
          <div className="flex items-start gap-2 border-b border-slate-700 px-3 py-2">
            <h2 className="flex-1 font-semibold leading-snug">{selected.title}</h2>
            <button
              onClick={() => {
                setSelected(null)
                clearSelectionRef.current()
              }}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2">
            {/* Row labels can repeat (several companies in a building) – key by position. */}
            {selected.rows.map(([k, v], i) => (
              <Fragment key={i}>
                <dt className="text-slate-400">{k}</dt>
                <dd className="break-words">{v}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="border-t border-slate-700 px-3 py-2 text-xs text-slate-400">Source: {selected.source}</p>
        </aside>
      )}
      {(waterLoading > 0 || status) && (
        <div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-slate-700 bg-panel/90 px-3 py-1.5 text-sm text-slate-200 backdrop-blur">
          {status ? (
            <>
              <TriangleAlert size={16} className="text-status-risk" />
              {status}
            </>
          ) : (
            <>
              <Loader2 size={16} className="animate-spin" />
              Loading water network…
            </>
          )}
        </div>
      )}
    </div>
  )
}
