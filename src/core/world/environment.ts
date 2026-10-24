import {
  type Vec3,
  V3,
  clamp,
  horizontalLength,
  length,
  sub,
} from '../math/vec3';
import { Rng } from '../math/random';
import type { ScenarioDefinition, TreeSpec, BuildingSpec } from './types';

export type Obstacle =
  | {
      kind: 'box';
      id: string;
      centerX: number;
      centerZ: number;
      halfWidth: number;
      halfDepth: number;
      height: number;
    }
  | {
      kind: 'cylinder';
      id: string;
      centerX: number;
      centerZ: number;
      radius: number;
      baseY: number;
      topY: number;
    };

export interface ObstacleReport {
  obstacle: Obstacle;
  clearance: number;
}

const boxFromBuilding = (b: BuildingSpec): Obstacle => ({
  kind: 'box',
  id: b.id,
  centerX: b.x,
  centerZ: b.z,
  halfWidth: b.width / 2,
  halfDepth: b.depth / 2,
  height: b.height,
});

const cylinderFromTree = (tree: TreeSpec): Obstacle => ({
  kind: 'cylinder',
  id: tree.id,
  centerX: tree.x,
  centerZ: tree.z,
  radius: Math.max(1.2, tree.radius * 0.82),
  baseY: Math.min(2.1, tree.height * 0.25),
  topY: tree.height,
});

/** Compass direction the wind comes FROM -> horizontal air velocity direction. */
const windDirectionFromDegrees = (fromDegrees: number): Vec3 => {
  const rad = (fromDegrees * Math.PI) / 180;
  return V3(-Math.sin(rad), 0, Math.cos(rad));
};

export const obstacleClearance = (obstacle: Obstacle, point: Vec3): number => {
  if (obstacle.kind === 'box') {
    const dx = Math.abs(point.x - obstacle.centerX) - obstacle.halfWidth;
    const dz = Math.abs(point.z - obstacle.centerZ) - obstacle.halfDepth;
    const dy = Math.max(-point.y, point.y - obstacle.height);
    if (dx <= 0 && dz <= 0 && dy <= 0) {
      return -Math.min(
        obstacle.halfWidth - Math.abs(point.x - obstacle.centerX),
        obstacle.halfDepth - Math.abs(point.z - obstacle.centerZ),
        Math.min(point.y, obstacle.height - point.y) + 0.001,
      );
    }
    return Math.hypot(Math.max(dx, 0), Math.max(dz, 0), Math.max(dy, 0));
  }

  const rho = Math.hypot(point.x - obstacle.centerX, point.z - obstacle.centerZ);
  const vertical = Math.max(obstacle.baseY - point.y, point.y - obstacle.topY);
  if (rho < obstacle.radius && vertical <= 0) {
    return -Math.min(
      obstacle.radius - rho,
      point.y - obstacle.baseY,
      obstacle.topY - point.y,
    );
  }
  return Math.hypot(Math.max(rho - obstacle.radius, 0), Math.max(vertical, 0));
};

export const segmentIntersectsBox = (
  a: Vec3,
  b: Vec3,
  obstacle: Extract<Obstacle, { kind: 'box' }>,
  padding = 0,
): boolean => {
  const minX = obstacle.centerX - obstacle.halfWidth - padding;
  const maxX = obstacle.centerX + obstacle.halfWidth + padding;
  const minY = -padding;
  const maxY = obstacle.height + padding;
  const minZ = obstacle.centerZ - obstacle.halfDepth - padding;
  const maxZ = obstacle.centerZ + obstacle.halfDepth + padding;

  let tMin = 0;
  let tMax = 1;
  const direction = sub(b, a);
  const axes: ReadonlyArray<readonly [number, number, number, number]> = [
    [a.x, direction.x, minX, maxX],
    [a.y, direction.y, minY, maxY],
    [a.z, direction.z, minZ, maxZ],
  ];
  for (const [origin, dir, min, max] of axes) {
    if (Math.abs(dir) < 1e-9) {
      if (origin < min || origin > max) return false;
      continue;
    }
    let t1 = (min - origin) / dir;
    let t2 = (max - origin) / dir;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
};

const segmentIntersectsCylinder = (
  a: Vec3,
  b: Vec3,
  obstacle: Extract<Obstacle, { kind: 'cylinder' }>,
  padding = 0,
): boolean => {
  const radius = obstacle.radius + padding;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const ox = a.x - obstacle.centerX;
  const oz = a.z - obstacle.centerZ;
  const qa = dx * dx + dz * dz;
  const qb = 2 * (ox * dx + oz * dz);
  const qc = ox * ox + oz * oz - radius * radius;
  let hit = false;
  let t0 = 0;
  let t1 = 1;
  if (qa < 1e-9) {
    hit = qc <= 0;
  } else {
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) return false;
    const root = Math.sqrt(disc);
    t0 = (-qb - root) / (2 * qa);
    t1 = (-qb + root) / (2 * qa);
    hit = t1 >= 0 && t0 <= 1;
  }
  if (!hit) return false;
  const enter = Math.max(t0, 0);
  const exit = Math.min(t1, 1);
  if (enter > exit) return false;
  const yEnter = a.y + (b.y - a.y) * enter;
  const yExit = a.y + (b.y - a.y) * exit;
  return Math.max(Math.min(yEnter, yExit), obstacle.baseY) <=
    Math.min(Math.max(yEnter, yExit), obstacle.topY);
};

export class WindField {
  private baseSpeed: number;
  private baseDirection: Vec3;
  private readonly gustStrength: number;
  private readonly rng: Rng;
  private gust: Vec3 = V3();
  private gustVertical = 0;
  private elapsed = 0;

  constructor(
    speed: number,
    fromDegrees: number,
    gustStrength: number,
    seed: number,
  ) {
    this.baseSpeed = speed;
    this.gustStrength = gustStrength;
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.baseDirection = windDirectionFromDegrees(fromDegrees);
  }

  reset(): void {
    this.gust = V3();
    this.gustVertical = 0;
    this.elapsed = 0;
  }

  setBase(speed: number, fromDegrees: number): void {
    this.baseSpeed = Math.max(0, speed);
    this.baseDirection = windDirectionFromDegrees(fromDegrees);
  }

  step(dt: number): void {
    this.elapsed += dt;
    const tau = 1.7;
    const kick = this.gustStrength * Math.sqrt((2 * dt) / tau);
    this.gust = V3(
      this.gust.x + (-this.gust.x / tau) * dt + this.rng.normal(0, 1) * kick,
      this.gust.y,
      this.gust.z + (-this.gust.z / tau) * dt + this.rng.normal(0, 1) * kick,
    );
    this.gustVertical =
      this.gustVertical * Math.exp(-dt / 2.4) + this.rng.normal(0, 1) * 0.12 * Math.sqrt(dt);
    const gustMagnitude = horizontalLength(this.gust);
    if (gustMagnitude > this.gustStrength * 1.35) {
      this.gust = V3(
        this.gust.x * ((this.gustStrength * 1.35) / gustMagnitude),
        0,
        this.gust.z * ((this.gustStrength * 1.35) / gustMagnitude),
      );
    }
  }

  sample(): Vec3 {
    const slow = Math.sin(this.elapsed * 0.27) * this.gustStrength * 0.22;
    return V3(
      this.baseDirection.x * this.baseSpeed + this.gust.x + slow,
      this.gustVertical,
      this.baseDirection.z * this.baseSpeed + this.gust.z,
    );
  }

  get meanSpeed(): number {
    return this.baseSpeed;
  }

  get fromCompassDegrees(): number {
    const from = V3(-this.baseDirection.x, 0, -this.baseDirection.z);
    let degrees = (Math.atan2(from.x, -from.z) * 180) / Math.PI;
    degrees %= 360;
    return degrees < 0 ? degrees + 360 : degrees;
  }

  get currentSpeed(): number {
    return length(this.sample());
  }
}

/** Static collision/visibility world plus the stochastic wind field. */
export class World {
  readonly scenario: ScenarioDefinition;
  readonly obstacles: Obstacle[];
  readonly wind: WindField;
  readonly bounds = { minX: -188, maxX: 188, minZ: -158, maxZ: 158 };

  constructor(scenario: ScenarioDefinition) {
    this.scenario = scenario;
    this.obstacles = [
      ...scenario.buildings.map(boxFromBuilding),
      ...scenario.trees.map(cylinderFromTree),
    ];
    this.wind = new WindField(
      scenario.weather.windSpeed,
      scenario.weather.windFromDeg,
      scenario.weather.gust,
      scenario.seed,
    );
  }

  reset(): void {
    this.wind.reset();
  }

  groundHeight(_x: number, _z: number): number {
    // The arena is deliberately flat. Distant terrain in the render layer is
    // non-collidable scenery, keeping the flight dynamics dataset honest.
    return 0;
  }

  /** Minimum signed clearance to any obstacle. */
  clearance(point: Vec3): ObstacleReport | null {
    let best: ObstacleReport | null = null;
    for (const obstacle of this.obstacles) {
      const clearance = obstacleClearance(obstacle, point);
      if (!best || clearance < best.clearance) best = { obstacle, clearance };
    }
    return best;
  }

  collisions(point: Vec3, radius: number): Obstacle | null {
    for (const obstacle of this.obstacles) {
      if (obstacleClearance(obstacle, point) < radius) return obstacle;
    }
    return null;
  }

  segmentBlocked(a: Vec3, b: Vec3, padding = 0): boolean {
    for (const obstacle of this.obstacles) {
      if (obstacle.kind === 'box') {
        if (segmentIntersectsBox(a, b, obstacle, padding)) return true;
      } else if (segmentIntersectsCylinder(a, b, obstacle, padding)) {
        return true;
      }
    }
    return false;
  }

  inBounds(point: Vec3): boolean {
    return (
      point.x > this.bounds.minX &&
      point.x < this.bounds.maxX &&
      point.z > this.bounds.minZ &&
      point.z < this.bounds.maxZ
    );
  }

  clampToBounds(point: Vec3): Vec3 {
    return V3(
      clamp(point.x, this.bounds.minX + 1, this.bounds.maxX - 1),
      point.y,
      clamp(point.z, this.bounds.minZ + 1, this.bounds.maxZ - 1),
    );
  }
}
