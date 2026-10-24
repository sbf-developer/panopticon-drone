/**
 * Minimal vector math for the simulation core. The rendering layer converts
 * these values to THREE.Vector3 at the boundary; keeping the core free of
 * renderer types makes the dynamics independently testable.
 *
 * World frame: +X east, +Y up, +Z south. Units are SI unless stated otherwise.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type MutableVec3 = { x: number; y: number; z: number };

export const V3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const UP: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });
export const NORTH: Vec3 = Object.freeze({ x: 0, y: 0, z: -1 });

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const scale = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});

export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => ({
  x: a.x + b.x * s,
  y: a.y + b.y * s,
  z: a.z + b.z * s,
});

export const mul = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x * b.x,
  y: a.y * b.y,
  z: a.z * b.z,
});

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const lengthSq = (a: Vec3): number => dot(a, a);
export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));
export const distanceSq = (a: Vec3, b: Vec3): number => lengthSq(sub(a, b));
export const distance = (a: Vec3, b: Vec3): number => Math.sqrt(distanceSq(a, b));

export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : V3();
};

export const clampLength = (a: Vec3, max: number): Vec3 => {
  const l = length(a);
  return l > max && l > 1e-9 ? scale(a, max / l) : a;
};

export const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const horizontal = (a: Vec3): Vec3 => ({ x: a.x, y: 0, z: a.z });
export const horizontalLength = (a: Vec3): number => Math.hypot(a.x, a.z);
export const withY = (a: Vec3, y: number): Vec3 => ({ x: a.x, y, z: a.z });

export const direction2D = (yaw: number): Vec3 => ({
  x: -Math.sin(yaw),
  y: 0,
  z: -Math.cos(yaw),
});

export const perpendicular2D = (a: Vec3): Vec3 => ({ x: -a.z, y: 0, z: a.x });

export const angleOf2D = (a: Vec3): number => Math.atan2(-a.x, -a.z);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));
export const clamp01 = (x: number): number => clamp(x, 0, 1);
export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (degrees: number): number => (degrees * Math.PI) / 180;

export const wrapPi = (angle: number): number => {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export const wrapTwoPi = (angle: number): number => {
  let a = angle % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a;
};

export const compassDegrees = (yaw: number): number => {
  let d = (-yaw * 180) / Math.PI;
  d %= 360;
  return d < 0 ? d + 360 : d;
};

export const compassRadians = (yaw: number): number => wrapTwoPi(-yaw);

/** Standard first-order low-pass step. `tau` is in seconds. */
export const lowPass = (current: number, target: number, tau: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-dt / Math.max(1e-6, tau)));
