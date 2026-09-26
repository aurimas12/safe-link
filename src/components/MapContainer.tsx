import { Box, Crosshair, Loader2, Map as MapIcon, Siren, TriangleAlert, X } from 'lucide-react'
import { bbox } from '@turf/turf'
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
  INCIDENT_CASCADE_LAYERS,
  INCIDENT_DIRECT_LAYERS,
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
import {
  DEFAULT_RADIUS_M,
  INCIDENT_LAYERS,
  INCIDENT_SOURCE,
  analyzeIncident,
  incidentZone,
  reverseGeocode,
  type Incident,
  type IncidentAnalysis,
} from '../map/incident'
import type { Sector } from '../map/responsibility'
import { NEXT, newReport, statusChange, type LogEntry, type Report } from '../map/workflow'
import CommLog from './CommLog'
import IncidentPanel from './IncidentPanel'
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
  map.addSource(INCIDENT_SOURCE, { type: 'geojson', data: EMPTY })
  for (const [id, source] of WATER_SOURCES) map.addSource(id, source)
  for (const { group, layer } of ORDERED_LAYERS) {
    map.addLayer({ ...layer, layout: { ...layer.layout, visibility: visibleGroups.has(group.id) ? 'visible' : 'none' } })
  }
  // Highlights: affected buildings above building fills; selected routes above lines but below points.
  const firstLine = ORDERED_LAYERS.find(({ layer }) => layer.type === 'line')?.layer.id
  const firstPoint = ORDERED_LAYERS.find(({ layer }) => layer.type === 'circle')?.layer.id
  for (const layer of HIGHLIGHT_LAYERS) map.addLayer(layer, layer.type === 'fill' ? firstLine : firstPoint)
  for (const layer of GRAPH_SELECTED_LAYERS) map.addLayer(layer, firstPoint)
  // Incident danger zone – above the network lines so it is always visible.
  for (const layer of INCIDENT_LAYERS) map.addLayer(layer, firstPoint)
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
  const [graphReady, setGraphReady] = useState(false)
  // Incident marker: placing mode (next map click sets it), position + radius, and its impact analysis.
  const [placing, setPlacing] = useState(false)
  const placingRef = useRef(false)
  const [incident, setIncident] = useState<Incident | null>(null)
  // The incident card can be collapsed without removing the incident from the map.
  const [incidentCollapsed, setIncidentCollapsed] = useState(false)
  // Incident report (sector, problem, address, status) and the communication log.
  const [report, setReport] = useState<Report | null>(null)
  const incidentSector = report?.sector ?? 'power'
  const [log, setLog] = useState<LogEntry[]>([])
  // The analysis belongs to one incident state – a stale one (older position / radius) is not shown.
  const [analysis, setAnalysis] = useState<{ for: Incident; sector: Sector; info: IncidentAnalysis } | null>(null)
  const incidentInfo = incident && analysis?.for === incident && analysis.sector === incidentSector ? analysis.info : null
  const incidentRef = useRef<{ incident: Incident | null; info: IncidentAnalysis | null }>({ incident: null, info: null })
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const applyIncidentRef = useRef<() => void>(() => {})
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
        setGraphReady(true)
      })
      .catch((err: unknown) => {
        console.warn(err)
        setGraphError(true)
      })

    // Click priority: points (substations, hydrants) → building → lines. Clicking inside a building always
    // opens the building, even when a cable or pipe runs across it.
    // --- incident zone and its highlights (re-applied after a basemap change) ---
    const applyIncident = () => {
      const { incident, info } = incidentRef.current
      ;(map.getSource(INCIDENT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(incident ? incidentZone(incident) : EMPTY)
      for (const [source, layer] of Object.entries(INCIDENT_DIRECT_LAYERS)) {
        if (map.getLayer(layer)) map.setFilter(layer, byIds(info ? (source === BUILDINGS_SOURCE ? info.direct.lez : info.direct.area) : []))
      }
      for (const [source, layer] of Object.entries(INCIDENT_CASCADE_LAYERS)) {
        if (map.getLayer(layer)) map.setFilter(layer, byIds(info ? (source === BUILDINGS_SOURCE ? info.cascade.lez : info.cascade.area) : []))
      }
    }
    applyIncidentRef.current = applyIncident
    map.on('style.load', applyIncident)

    map.on('click', (e) => {
      // Placing mode: the click sets the incident location instead of selecting an object.
      if (placingRef.current) {
        placingRef.current = false
        setPlacing(false)
        map.getCanvas().style.cursor = ''
        const placed: Incident = { center: [e.lngLat.lng, e.lngLat.lat], radiusM: incidentRef.current.incident?.radiusM ?? DEFAULT_RADIUS_M }
        setIncident(placed)
        // A new incident starts a new report; an existing one (moved by placing again) keeps its report.
        setReport((r) => r ?? newReport())
        // Show the whole zone in the free part of the screen – between the menu (left) and the incident card (right).
        const [w, s, east, n] = bbox(incidentZone(placed))
        const wide = map.getCanvas().clientWidth >= 900
        map.fitBounds(
          [
            [w, s],
            [east, n],
          ],
          { padding: { top: 60, bottom: 60, left: wide ? 360 : 40, right: wide ? 420 : 40 }, maxZoom: 16, duration: 600 },
        )
        return
      }
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

  // Incident: zone on the map, draggable pulsing marker and impact analysis.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    incidentRef.current = { incident, info: null }
    applyIncidentRef.current()
    if (!incident) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    if (!markerRef.current) {
      const el = document.createElement('div')
      el.className = 'relative flex h-6 w-6 items-center justify-center'
      el.title = 'Drag to move the incident'
      el.innerHTML =
        '<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75"></span>' +
        '<span class="relative inline-flex h-4 w-4 rounded-full border-2 border-white bg-red-500 shadow-lg"></span>'
      markerRef.current = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(incident.center).addTo(map)
      markerRef.current.on('dragend', () => {
        const p = markerRef.current!.getLngLat()
        setIncident((prev) => (prev ? { ...prev, center: [p.lng, p.lat] } : prev))
      })
    } else markerRef.current.setLngLat(incident.center)

    let cancelled = false
    analyzeIncident(incident, stateRef.current.graph, incidentSector).then((info) => {
      if (cancelled) return
      incidentRef.current = { incident, info }
      setAnalysis({ for: incident, sector: incidentSector, info })
      applyIncidentRef.current()
    })
    return () => {
      cancelled = true
    }
  }, [incident, graphReady, incidentSector])

  // Address from the official Klaipėda address locator – unless the operator typed it in.
  const incidentCenter = incident?.center
  useEffect(() => {
    if (!incidentCenter) return
    let cancelled = false
    reverseGeocode(incidentCenter).then((address) => {
      if (!cancelled) setReport((r) => (r && !r.addressEdited ? { ...r, address } : r))
    })
    return () => {
      cancelled = true
    }
  }, [incidentCenter])

  const advanceIncident = () => {
    if (!report || !incident) return
    const next = NEXT[report.status]
    if (!next) return
    setLog((l) => [...l, ...statusChange(report, next.to, incidentInfo, incident.radiusM)])
    setReport({ ...report, status: next.to })
  }

  const removeIncident = () => {
    setIncident(null)
    setReport(null)
    setIncidentCollapsed(false)
  }

  const startPlacing = () => {
    const next = !placing
    placingRef.current = next
    setPlacing(next)
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = next ? 'crosshair' : ''
  }

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
          <button
            onClick={startPlacing}
            className={placing ? `${control} border-red-500 bg-red-500/80 text-white hover:bg-red-500` : control}
            title="Mark a detected incident: click the map to place it"
          >
            <Siren size={16} />
            {placing ? 'Click the map…' : 'Incident'}
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
      <div className="absolute right-14 top-3 flex max-h-[calc(100%-5rem)] w-96 max-w-[calc(100vw-5rem)] flex-col gap-2">
      {incident && report && (
        <IncidentPanel
          incident={incident}
          info={incidentInfo}
          report={report}
          collapsed={incidentCollapsed}
          onToggleCollapsed={() => setIncidentCollapsed((v) => !v)}
          onReport={(patch) => setReport((r) => (r ? { ...r, ...patch } : r))}
          onRadius={(radiusM) => setIncident({ ...incident, radiusM })}
          onAdvance={advanceIncident}
          onRemove={removeIncident}
        />
      )}
      {selected && (
        <aside className="overflow-y-auto rounded-md border border-slate-700 bg-panel/95 text-sm text-slate-200 shadow-xl backdrop-blur">
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
      </div>
      {/* Bottom bar – between the menu (left) and the right-hand cards on wide screens. */}
      <div className="pointer-events-none absolute bottom-9 left-3 right-3 flex flex-col items-center gap-2 lg:left-[20rem] lg:right-[28rem]">
      {(waterLoading > 0 || status) && (
        <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-panel/90 px-3 py-1.5 text-sm text-slate-200 backdrop-blur">
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
      {log.length > 0 && <CommLog entries={log} />}
      </div>
    </div>
  )
}
