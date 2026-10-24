import { Rng } from '../math/random';
import { clamp, compassRadians } from '../math/vec3';
import { RoutePath, type Point2 } from './path';
import type {
  BuildingSpec,
  DroneScenarioSpec,
  PropSpec,
  ScenarioDefinition,
  SceneTheme,
  TargetScenarioSpec,
  TreeSpec,
  Weather,
} from './types';

const CAMPUS_ROUTE: Point2[] = [
  { x: 55, z: -78 },
  { x: 98, z: -55 },
  { x: 118, z: -12 },
  { x: 112, z: 38 },
  { x: 78, z: 78 },
  { x: 28, z: 88 },
  { x: -30, z: 84 },
  { x: -82, z: 66 },
  { x: -116, z: 28 },
  { x: -122, z: -26 },
  { x: -98, z: -65 },
  { x: -48, z: -82 },
  { x: 2, z: -86 },
];

const CANOPY_ROUTE: Point2[] = [
  { x: 15, z: 45 },
  { x: 55, z: 62 },
  { x: 92, z: 40 },
  { x: 105, z: 2 },
  { x: 88, z: -38 },
  { x: 50, z: -68 },
  { x: 8, z: -58 },
  { x: -28, z: -86 },
  { x: -70, z: -64 },
  { x: -100, z: -22 },
  { x: -92, z: 28 },
  { x: -58, z: 66 },
  { x: -18, z: 78 },
];

const RIDGE_ROUTE: Point2[] = [
  { x: 30, z: 85 },
  { x: 92, z: 62 },
  { x: 122, z: 8 },
  { x: 108, z: -55 },
  { x: 58, z: -94 },
  { x: -15, z: -102 },
  { x: -78, z: -78 },
  { x: -118, z: -25 },
  { x: -116, z: 32 },
  { x: -75, z: 76 },
  { x: -20, z: 96 },
];

const CAMPUS_THEME: SceneTheme = {
  ground: '#74835b',
  groundAccent: '#5d6d49',
  road: '#303234',
  roadEdge: '#c9c5b4',
  buildingTints: [0xb9b4a5, 0x98a3a6, 0xc1b9a8, 0x8b9296, 0xa69f8f],
  roof: '#4a4d4e',
  windowGlow: '#ffd9a2',
  treeTints: [0x486237, 0x587345, 0x3e5631],
  trunk: '#4c4132',
  fog: '#b7c7cf',
  fogDensity: 0.0019,
  horizon: '#c7d4d8',
  sunElevationDeg: 42,
  sunAzimuthDeg: 142,
  exposure: 1.0,
  ambientIntensity: 0.55,
  roadKind: 'asphalt',
  cloudCover: 0.4,
};

const CANOPY_THEME: SceneTheme = {
  ground: '#5e7048',
  groundAccent: '#4b5c38',
  road: '#554b39',
  roadEdge: '#9b8c6e',
  buildingTints: [0x786550, 0x8a765a, 0x655744],
  roof: '#3d3429',
  windowGlow: '#ffc97b',
  treeTints: [0x304b2b, 0x3d5c31, 0x496b37],
  trunk: '#3c3329',
  fog: '#c7b48e',
  fogDensity: 0.0032,
  horizon: '#dccba6',
  sunElevationDeg: 15,
  sunAzimuthDeg: 248,
  exposure: 1.08,
  ambientIntensity: 0.42,
  roadKind: 'dirt',
  cloudCover: 0.15,
};

const RIDGE_THEME: SceneTheme = {
  ground: '#8b7955',
  groundAccent: '#756445',
  road: '#6f624e',
  roadEdge: '#a89877',
  buildingTints: [0x9b8e78, 0x8b7f6b, 0xaa9b82],
  roof: '#5a4d3c',
  windowGlow: '#ffd291',
  treeTints: [0x58613a, 0x687044, 0x4b5532],
  trunk: '#4a3e2e',
  fog: '#d3c4a7',
  fogDensity: 0.0017,
  horizon: '#e1d3b6',
  sunElevationDeg: 54,
  sunAzimuthDeg: 118,
  exposure: 0.98,
  ambientIntensity: 0.65,
  roadKind: 'dirt',
  cloudCover: 0.2,
};

const CAMPUS_BUILDINGS: BuildingSpec[] = [
  { id: 'ops', x: -58, z: -16, width: 34, depth: 24, height: 25, style: 'office', tint: 0xb9b4a5 },
  { id: 'lab-2', x: -74, z: 28, width: 24, depth: 20, height: 17, style: 'office', tint: 0x98a3a6 },
  { id: 'atrium', x: -29, z: 49, width: 22, depth: 18, height: 12, style: 'office', tint: 0xc1b9a8 },
  { id: 'warehouse', x: 67, z: -43, width: 27, depth: 18, height: 13, style: 'warehouse', tint: 0x8b8c86 },
  { id: 'tower', x: 48, z: 26, width: 18, depth: 18, height: 38, style: 'tower', tint: 0x939aa0 },
  { id: 'lab-3', x: 12, z: -31, width: 15, depth: 13, height: 10, style: 'office', tint: 0xa69f8f },
  { id: 'utility', x: -21, z: -50, width: 18, depth: 14, height: 8, style: 'warehouse', tint: 0x9a9588 },
  { id: 'hangar', x: -97, z: -37, width: 30, depth: 40, height: 12, style: 'warehouse', tint: 0x8e9699 },
  { id: 'east-office', x: 143, z: -12, width: 28, depth: 22, height: 26, style: 'office', tint: 0xb5ab98 },
  { id: 'west-tower', x: -148, z: 0, width: 24, depth: 30, height: 32, style: 'tower', tint: 0x8f979c },
  { id: 'north-office', x: -22, z: 116, width: 32, depth: 22, height: 17, style: 'office', tint: 0xa8a08f },
  { id: 'north-warehouse', x: 88, z: 118, width: 26, depth: 20, height: 20, style: 'warehouse', tint: 0x94958e },
  { id: 'south-hangar', x: 0, z: -128, width: 36, depth: 20, height: 18, style: 'warehouse', tint: 0x9c9689 },
  { id: 'east-lab', x: 153, z: 70, width: 22, depth: 18, height: 15, style: 'office', tint: 0xb2aa9a },
];

const CANOPY_BUILDINGS: BuildingSpec[] = [
  { id: 'ranger', x: -14, z: 8, width: 9, depth: 7, height: 6, style: 'cabin', tint: 0x7d6750 },
  { id: 'barn', x: 58, z: 13, width: 16, depth: 10, height: 9, style: 'barn', tint: 0x6f5b45 },
  { id: 'sawmill', x: 62, z: -74, width: 20, depth: 12, height: 8, style: 'warehouse', tint: 0x756452 },
  { id: 'lookout', x: 28, z: 80, width: 5, depth: 5, height: 14, style: 'cabin', tint: 0x8a7358 },
  { id: 'cabin-2', x: -47, z: -18, width: 8, depth: 6, height: 5, style: 'cabin', tint: 0x806b53 },
];

const RIDGE_BUILDINGS: BuildingSpec[] = [
  { id: 'farmhouse', x: -48, z: 22, width: 13, depth: 9, height: 7, style: 'cabin', tint: 0x9b8e78 },
  { id: 'barn', x: -63, z: 7, width: 17, depth: 11, height: 9, style: 'barn', tint: 0x8b7054 },
  { id: 'silo-a', x: -79, z: 16, width: 6, depth: 6, height: 15, style: 'silo', tint: 0xaaa08e },
  { id: 'silo-b', x: -79, z: 27, width: 6, depth: 6, height: 15, style: 'silo', tint: 0x9f9684 },
  { id: 'pump-house', x: 22, z: -24, width: 8, depth: 6, height: 5, style: 'warehouse', tint: 0x8f8068 },
];

const toBuildingList = (items: BuildingSpec[]): BuildingSpec[] => items;

const makeRng = (seed: number): Rng => new Rng(seed);

const buildingClearance = (buildings: readonly BuildingSpec[], x: number, z: number, pad: number): boolean =>
  buildings.every((b) => {
    const dx = Math.max(Math.abs(x - b.x) - b.width / 2, 0);
    const dz = Math.max(Math.abs(z - b.z) - b.depth / 2, 0);
    return Math.hypot(dx, dz) > pad;
  });

const routeClearance = (route: RoutePath, x: number, z: number, radius: number, pad: number): boolean =>
  route.distanceTo(x, z) > radius + pad;

const segmentDistance = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const lenSq = vx * vx + vz * vz;
  const t = lenSq > 1e-9 ? clamp((wx * vx + wz * vz) / lenSq, 0, 1) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
};

interface ScatterOptions {
  count: number;
  route: RoutePath;
  roadWidth: number;
  buildings: BuildingSpec[];
  home: Point2;
  cue: Point2;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  minHeight: number;
  maxHeight: number;
  rng: Rng;
  styleBias?: number;
}

const scatterTrees = (options: ScatterOptions): TreeSpec[] => {
  const { rng, route, buildings, home, cue, bounds } = options;
  const trees: TreeSpec[] = [];
  let attempts = 0;
  while (trees.length < options.count && attempts < options.count * 30) {
    attempts += 1;
    const x = rng.range(bounds.minX, bounds.maxX);
    const z = rng.range(bounds.minZ, bounds.maxZ);
    if (Math.hypot(x - home.x, z - home.z) < 34) continue;
    if (!routeClearance(route, x, z, options.roadWidth / 2, 5.5)) continue;
    if (!buildingClearance(buildings, x, z, 4)) continue;
    if (segmentDistance(x, z, home.x, home.z, cue.x, cue.z) < 13) continue;
    // Avoid the immediate target pick-up and home approach.
    if (Math.hypot(x - cue.x, z - cue.z) < 18) continue;
    const radius = rng.range(2.0, 4.1);
    const height = rng.range(options.minHeight, options.maxHeight);
    const style = rng.next() < (options.styleBias ?? 0.35) ? 'pine' : 'broadleaf';
    trees.push({
      id: `tree-${trees.length}`,
      x,
      z,
      height,
      radius,
      style,
      tint: rng.int(0, 2),
    });
  }
  return trees;
};

const scatterProps = (rng: Rng, count: number, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, avoid: Point2): PropSpec[] => {
  const props: PropSpec[] = [];
  const kinds: PropSpec['kind'][] = ['container', 'tank', 'solar', 'truck', 'antenna'];
  let attempts = 0;
  while (props.length < count && attempts < count * 20) {
    attempts += 1;
    const x = rng.range(bounds.minX, bounds.maxX);
    const z = rng.range(bounds.minZ, bounds.maxZ);
    if (Math.hypot(x - avoid.x, z - avoid.z) < 45) continue;
    props.push({
      id: `prop-${props.length}`,
      kind: rng.pick(kinds),
      x,
      z,
      rotation: rng.range(0, Math.PI * 2),
      scale: rng.range(0.75, 1.3),
    });
  }
  return props;
};

const withHomeYaw = (home: Point2, cue: Point2): number =>
  compassRadians(Math.atan2(cue.x - home.x, -(cue.z - home.z)));

const weatherFor = (windSpeed: number, windFromDeg: number, gust: number, visibility: number): Weather => ({
  windSpeed,
  windFromDeg,
  gust,
  visibility,
});

const droneFor = (home: Point2, cue: Point2, altitude: number, standoff: number, orbit: number): DroneScenarioSpec => ({
  home,
  initialYaw: withHomeYaw(home, cue),
  cruiseAltitude: altitude,
  standoff,
  orbitRadius: orbit,
  searchCue: cue,
});

const targetFor = (
  label: string,
  vehicleClass: string,
  cruiseSpeed: number,
  variance: number,
  maxAcceleration: number,
  routeDistance: number,
  color: number,
  evasive: boolean,
  departureDelay: number,
): TargetScenarioSpec => ({
  label,
  vehicleClass,
  cruiseSpeed,
  speedVariance: variance,
  maxAcceleration,
  initialRouteDistance: routeDistance,
  departureDelay,
  color,
  evasive,
});

const buildCampus = (): ScenarioDefinition => {
  const rng = makeRng(20260412);
  const route = new RoutePath(CAMPUS_ROUTE, 1.5);
  const cue = { x: 55, z: -78 };
  const home = { x: 0, z: 15 };
  const trees = scatterTrees({
    count: 84,
    route,
    roadWidth: 12,
    buildings: CAMPUS_BUILDINGS,
    home,
    cue,
    bounds: { minX: -168, maxX: 168, minZ: -142, maxZ: 142 },
    minHeight: 9,
    maxHeight: 18,
    rng,
  });
  const props = scatterProps(rng, 9, { minX: -120, maxX: 130, minZ: -90, maxZ: 100 }, home);
  return {
    id: 'campus',
    name: 'Ridgeway Campus',
    code: 'CMP-04',
    description:
      'A occupied research campus with a service road loop, mid-rise structures, and steady crosswind. The subject vehicle is a soft-top utility truck moving at traffic speed.',
    objective: 'Maintain a 24 m standoff behind the subject while preserving visual contact through the campus corridor.',
    difficulty: 'STANDARD',
    seed: 20260412,
    theme: CAMPUS_THEME,
    weather: weatherFor(4.2, 245, 2.1, 320),
    drone: droneFor(home, cue, 40, 24, 28),
    target: targetFor('SUBJECT-01', 'Utility truck', 10.5, 2.2, 2.2, 0, 0xd4653a, false, 11),
    route: CAMPUS_ROUTE,
    roadWidth: 12,
    buildings: toBuildingList(CAMPUS_BUILDINGS),
    trees,
    props,
  };
};

const buildCanopy = (): ScenarioDefinition => {
  const rng = makeRng(7712301);
  const route = new RoutePath(CANOPY_ROUTE, 1.3);
  const cue = { x: 15, z: 45 };
  const home = { x: 0, z: 0 };
  const trees = scatterTrees({
    count: 245,
    route,
    roadWidth: 8,
    buildings: CANOPY_BUILDINGS,
    home,
    cue,
    bounds: { minX: -145, maxX: 150, minZ: -125, maxZ: 125 },
    minHeight: 13,
    maxHeight: 25,
    rng,
    styleBias: 0.6,
  });
  const props: PropSpec[] = [
    { id: 'water-tank', kind: 'tank', x: -33, z: 14, rotation: 0, scale: 0.9 },
    { id: 'log-truck', kind: 'truck', x: 71, z: -55, rotation: 0.4, scale: 1.1 },
  ];
  return {
    id: 'canopy',
    name: 'Blackpine Corridor',
    code: 'BPC-11',
    description:
      'A low-altitude pursuit through a managed pine corridor at golden hour. Narrow sight lines and tall canopies punish greedy flight paths.',
    objective: 'Hold visual lock below the canopy at 16 m while threading the forest service track. Standoff is tightened to 15 m.',
    difficulty: 'HIGH',
    seed: 7712301,
    theme: CANOPY_THEME,
    weather: weatherFor(2.6, 190, 1.4, 180),
    drone: droneFor(home, cue, 16, 15, 18),
    target: targetFor('SUBJECT-07', 'Forest service pickup', 8.3, 1.7, 1.9, 0, 0xc96f37, true, 10),
    route: CANOPY_ROUTE,
    roadWidth: 8,
    buildings: toBuildingList(CANOPY_BUILDINGS),
    trees,
    props,
  };
};

const buildRidge = (): ScenarioDefinition => {
  const rng = makeRng(449002);
  const route = new RoutePath(RIDGE_ROUTE, 1.6);
  const cue = { x: 30, z: 85 };
  const home = { x: 0, z: 20 };
  const trees = scatterTrees({
    count: 62,
    route,
    roadWidth: 9,
    buildings: RIDGE_BUILDINGS,
    home,
    cue,
    bounds: { minX: -160, maxX: 160, minZ: -135, maxZ: 135 },
    minHeight: 7,
    maxHeight: 14,
    rng,
    styleBias: 0.2,
  });
  const props = scatterProps(rng, 14, { minX: -120, maxX: 130, minZ: -100, maxZ: 100 }, home);
  return {
    id: 'ridge',
    name: 'Dry Creek Range',
    code: 'DCR-02',
    description:
      'Open highland terrain with a fast-moving subject and a 9 m/s crosswind. Long sight lines make this primarily a guidance and disturbance-rejection trial.',
    objective: 'Track a fleeing utility vehicle across open range at 28 m AGL. Expect significant wind-induced velocity error.',
    difficulty: 'ELEVATED',
    seed: 449002,
    theme: RIDGE_THEME,
    weather: weatherFor(9.0, 268, 4.6, 520),
    drone: droneFor(home, cue, 28, 30, 32),
    target: targetFor('SUBJECT-12', 'Range runner', 15.0, 4.0, 3.1, 0, 0xb84f38, true, 8),
    route: RIDGE_ROUTE,
    roadWidth: 9,
    buildings: toBuildingList(RIDGE_BUILDINGS),
    trees,
    props,
  };
};

const SCENARIOS: ScenarioDefinition[] = [buildCampus(), buildCanopy(), buildRidge()];

export const getScenarios = (): readonly ScenarioDefinition[] => SCENARIOS;

export const getScenario = (id: string): ScenarioDefinition =>
  SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0]!;

export const createScenarioById = (id: string): ScenarioDefinition => getScenario(id);
