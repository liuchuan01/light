import mapping from '../assets/unicorn-regions.json';
import { POINT_IDS } from './scenes';

export type ModelViewId = 'front' | 'back';
export interface ModelRegion {
  id: string;
  view: ModelViewId;
  name: string;
  path: string;
  anchor: number[];
  label: number[];
  geometry: 'traced' | 'schematic';
}

// Mapping is sourced from docs/unicorn2.png. It is independent of scene colors.
export const MODEL_REGIONS = mapping.regions as ModelRegion[];
export const MODEL_VIEWS = {
  front: { label: '正面', viewBox: '0 0 468 690', count: 18 },
  back: { label: '背面', viewBox: '443 0 401 690', count: 5 },
} as const;
export const MODEL_POINTS = POINT_IDS.map((id, protocolIndex) => {
  const region = MODEL_REGIONS.find(item => item.id === id)!;
  return { id, protocolIndex, regionName: region.name, view: region.view, geometry: region.geometry };
});
