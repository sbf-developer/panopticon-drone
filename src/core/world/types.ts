import type { Point2 } from './path';

export type BuildingStyle = 'office' | 'tower' | 'warehouse' | 'cabin' | 'barn' | 'silo';

export interface BuildingSpec {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  style: BuildingStyle;
  tint: number;
}

export interface TreeSpec {
  id: string;
  x: number;
  z: number;
  height: number;
  radius: number;
  style: 'broadleaf' | 'pine';
  tint: number;
}

export type PropKind = 'container' | 'tank' | 'silo' | 'antenna' | 'solar' | 'truck';

export interface PropSpec {
  id: string;
  kind: PropKind;
  x: number;
  z: number;
  rotation: number;
  scale: number;
}

export interface SceneTheme {
  ground: string;
  groundAccent: string;
  road: string;
  roadEdge: string;
  buildingTints: number[];
  roof: string;
  windowGlow: string;
  treeTints: number[];
  trunk: string;
  fog: string;
  fogDensity: number;
  horizon: string;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  exposure: number;
  ambientIntensity: number;
  roadKind: 'asphalt' | 'dirt';
  cloudCover: number;
}

export interface Weather {
  /** Mean wind speed at 10 m AGL, m/s. */
  windSpeed: number;
  /** Compass direction the wind comes FROM (0 = north, 90 = east). */
  windFromDeg: number;
  /** Peak gust amplitude in m/s. */
  gust: number;
  visibility: number;
}

export interface DroneScenarioSpec {
  home: Point2;
  initialYaw: number;
  cruiseAltitude: number;
  standoff: number;
  orbitRadius: number;
  /** Operator-provided initial cue for the visual search. */
  searchCue: Point2;
}

export interface TargetScenarioSpec {
  label: string;
  vehicleClass: string;
  cruiseSpeed: number;
  speedVariance: number;
  maxAcceleration: number;
  initialRouteDistance: number;
  departureDelay: number;
  color: number;
  evasive: boolean;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  code: string;
  description: string;
  objective: string;
  difficulty: 'STANDARD' | 'ELEVATED' | 'HIGH';
  seed: number;
  theme: SceneTheme;
  weather: Weather;
  drone: DroneScenarioSpec;
  target: TargetScenarioSpec;
  route: Point2[];
  roadWidth: number;
  buildings: BuildingSpec[];
  trees: TreeSpec[];
  props: PropSpec[];
}
