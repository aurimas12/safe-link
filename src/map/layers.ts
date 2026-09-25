import type { LayerSpecification } from 'maplibre-gl'

// Meniu punktas: vienas jungiklis gali valdyti kelis žemėlapio sluoksnius (pvz. taškai + etiketės).
export interface LayerGroup {
  id: string
  label: string
  color: string
  // null – skaičius nežinomas iš anksto (duomenys kraunami pagal matomą žemėlapio dalį).
  count: number | null
  layers: LayerSpecification[]
}
