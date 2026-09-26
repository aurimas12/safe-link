import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl'
import graphUrl from '../data/lez_graph.json?url'
import type { LayerGroup } from './layers'

// Influence graph (npm run build:graph): what feeds what with electricity and water, and which buildings
// depend on each network node. ~11 MB – loaded at runtime, not bundled.
// Edges follow the real cable / pipe routes (`segments`); inferred links are straight dashed lines.

export type Confidence = 'kabelis' | 'greta' | 'numanomas'

export interface GraphNode {
  id: string
  type: 'building' | 'substation' | 'substation_hv' | 'water_main' | 'water_valve'
  name: string | null
  kind?: string
  voltage_kv?: string
  lez?: boolean
  purpose?: string | null
  coords: [number, number]
  affects?: string[]
  impact?: { lez: number; other: number; other_by_purpose: Record<string, number> }
}
interface GraphEdge {
  from: string
  to: string
  kind: 'power' | 'water'
  confidence: Confidence
  evidence: string
  path: number[]
}
export interface BuildingDeps {
  power: { device: string; chain: string[]; confidence: Confidence; evidence: string; reaches_hv: boolean } | null
  water: {
    confidence: Confidence
    evidence: string
    path_length_m: number
    min_diameter_mm: number | null
    critical_valves: string[]
    hydrants_150m: number
    nearest_hydrant: { id: string; distance_m: number } | null
  } | null
}
interface GraphFile {
  segments: { coords: [number, number][]; straight?: true }[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  buildings: Record<string, BuildingDeps>
}

export interface Graph {
  file: GraphFile
  node: Map<string, GraphNode>
  incoming: Map<string, GraphEdge[]>
  outgoing: Map<string, GraphEdge[]>
}

let graphPromise: Promise<Graph> | null = null
export function loadGraph(): Promise<Graph> {
  graphPromise ??= fetch(graphUrl)
    .then((r) => r.json() as Promise<GraphFile>)
    .then((file) => {
      const incoming = new Map<string, GraphEdge[]>()
      const outgoing = new Map<string, GraphEdge[]>()
      for (const e of file.edges) {
        if (!incoming.has(e.to)) incoming.set(e.to, [])
        incoming.get(e.to)!.push(e)
        if (!outgoing.has(e.from)) outgoing.set(e.from, [])
        outgoing.get(e.from)!.push(e)
      }
      return { file, node: new Map(file.nodes.map((n) => [n.id, n])), incoming, outgoing }
    })
  return graphPromise
}

// Edge route from segment references: +n – segment n-1 as stored, -n – reversed.
function edgeCoords(g: Graph, e: GraphEdge): [number, number][] {
  const out: [number, number][] = []
  for (const ref of e.path) {
    const seg = g.file.segments[Math.abs(ref) - 1].coords
    const coords = ref > 0 ? seg : [...seg].reverse()
    out.push(...(out.length ? coords.slice(1) : coords))
  }
  // Building ends of a route may stop at the wall; an empty route falls back to a straight line.
  return out.length >= 2 ? out : [g.node.get(e.from)!.coords, g.node.get(e.to)!.coords]
}
const edgeFeature = (g: Graph, e: GraphEdge): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: 'Feature',
  properties: { kind: e.kind, confidence: e.confidence },
  geometry: { type: 'LineString', coordinates: edgeCoords(g, e) },
})

export const GRAPH_SOURCE = 'lez-graph'
export const GRAPH_SELECTED_SOURCE = 'lez-graph-selected'
export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
export const graphData = (g: Graph): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: g.file.edges.map((e) => edgeFeature(g, e)),
})

const POWER = '#f472b6'
const WATER = '#38bdf8'
const color: ExpressionSpecification = ['match', ['get', 'kind'], 'power', POWER, WATER]
// Inferred links – dashed: there is no direct link in the source data.
const inferred: ExpressionSpecification = ['==', ['get', 'confidence'], 'numanomas']

const edgeLayers = (id: string, source: string, width: number, opacity: number): LayerSpecification[] => [
  {
    id,
    type: 'line',
    source,
    filter: ['!', inferred],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width, 'line-opacity': opacity },
  },
  {
    id: `${id}-inferred`,
    type: 'line',
    source,
    filter: inferred,
    paint: { 'line-color': color, 'line-width': width, 'line-opacity': opacity, 'line-dasharray': [2, 2] },
  },
]

export const GRAPH_GROUP: LayerGroup = {
  id: 'lez_graph',
  label: 'Dependency graph',
  color: '#e2e8f0',
  count: null,
  layers: edgeLayers('lez-graph', GRAPH_SOURCE, 1.2, 0.6),
}

// Highlighted routes of the selection – shown even when the graph layer is off.
export const GRAPH_SELECTED_LAYERS = edgeLayers('lez-graph-selected', GRAPH_SELECTED_SOURCE, 4, 1)

// Everything a building depends on (walking upstream: building ← TR ← SP ← 110 kV, building ← valve ← main).
export function upstream(g: Graph, nodeId: string): GeoJSON.FeatureCollection {
  return walk(g, nodeId, g.incoming, (e) => e.from)
}
// Everything that depends on a network node (walking downstream) – the node's influence.
export function downstream(g: Graph, nodeId: string): GeoJSON.FeatureCollection {
  return walk(g, nodeId, g.outgoing, (e) => e.to)
}
function walk(g: Graph, start: string, index: Map<string, GraphEdge[]>, next: (e: GraphEdge) => string) {
  const out: GraphEdge[] = []
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop()!
    for (const e of index.get(id) ?? []) {
      const key = `${e.from}>${e.to}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e)
      stack.push(next(e))
    }
  }
  return { type: 'FeatureCollection' as const, features: out.map((e) => edgeFeature(g, e)) }
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  kabelis: 'direct link',
  greta: 'transformer next to the building',
  numanomas: 'inferred',
}

const nodeLabel = (g: Graph, id: string) => {
  const n = g.node.get(id)
  if (!n) return id
  return n.type === 'substation_hv' ? `${n.name} ${n.voltage_kv} kV` : (n.name ?? id)
}

// Building dependency rows for the side panel.
export function describeDependencies(g: Graph, buildingId: string): [string, string][] {
  const deps = g.file.buildings[buildingId]
  if (!deps) return []
  const rows: [string, string][] = []
  if (deps.power) {
    // Chain from the source to the building: 110 kV → SP → TR → building.
    rows.push(['Electricity', [...deps.power.chain].reverse().map((id) => nodeLabel(g, id)).concat('building').join(' → ')])
    rows.push(['Power link', `${CONFIDENCE_LABEL[deps.power.confidence]} (${deps.power.evidence})`])
  } else rows.push(['Electricity', 'no link found (no transformer within 150 m)'])
  if (deps.water) {
    const w = deps.water
    rows.push(['Water', `main → ${w.path_length_m} m of pipes → building`])
    rows.push(['Water link', `${CONFIDENCE_LABEL[w.confidence]} (${w.evidence})`])
    if (w.min_diameter_mm) rows.push(['Narrowest pipe', `Ø${w.min_diameter_mm} mm`])
    rows.push([
      'Critical valves',
      w.critical_valves.length
        ? `${w.critical_valves.length} – closing any of them cuts the water supply`
        : 'none – water can arrive by more than one route',
    ])
    rows.push([
      'Hydrants ≤ 150 m',
      w.hydrants_150m ? `${w.hydrants_150m}, nearest ${w.nearest_hydrant!.distance_m} m` : 'none',
    ])
  } else rows.push(['Water', 'no pipe within 50 m in the source data'])
  return rows
}
