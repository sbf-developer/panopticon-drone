import { distanceSq } from '../math/vec3';

export interface Point2 {
  x: number;
  z: number;
}

export interface RouteSample {
  x: number;
  z: number;
  /** Distance travelled along the closed route, in metres. */
  s: number;
}

/**
 * Smooth, arc-length parameterised closed route. Catmull-Rom is used only to
 * build the centre line; runtime lookups are O(log n) and do not evaluate
 * splines, which keeps target physics and map generation deterministic.
 */
export class RoutePath {
  readonly samples: RouteSample[];
  readonly length: number;

  constructor(controlPoints: readonly Point2[], spacing = 1.5) {
    if (controlPoints.length < 3) throw new Error('A closed route needs at least 3 points');
    const dense: Point2[] = [];
    const n = controlPoints.length;
    for (let i = 0; i < n; i += 1) {
      const p0 = controlPoints[(i - 1 + n) % n]!;
      const p1 = controlPoints[i]!;
      const p2 = controlPoints[(i + 1) % n]!;
      const p3 = controlPoints[(i + 2) % n]!;
      const segmentSamples = 40;
      for (let step = 0; step < segmentSamples; step += 1) {
        dense.push(catmullRom(p0, p1, p2, p3, step / segmentSamples));
      }
    }
    dense.push({ ...dense[0]! });

    const resampled: RouteSample[] = [];
    let carried = 0;
    let travelled = 0;
    for (let i = 0; i < dense.length - 1; i += 1) {
      const a = dense[i]!;
      const b = dense[i + 1]!;
      const segLength = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLength < 1e-9) continue;
      while (carried <= segLength) {
        const t = carried / segLength;
        resampled.push({
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
          s: travelled + carried,
        });
        carried += spacing;
      }
      carried -= segLength;
      travelled += segLength;
    }
    if (resampled.length < 2) throw new Error('Route is too short');

    // Close the loop smoothly by appending the first point at total length.
    const totalLength = travelled;
    this.samples = resampled;
    this.length = totalLength;
  }

  pointAt(distance: number): RouteSample {
    const s = ((distance % this.length) + this.length) % this.length;
    // Binary search for the last sample with s <= target.
    let lo = 0;
    let hi = this.samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.samples[mid]!.s <= s) lo = mid;
      else hi = mid - 1;
    }
    const a = this.samples[lo]!;
    const b = this.samples[(lo + 1) % this.samples.length]!;
    let span = b.s - a.s;
    if (span <= 0) span = this.length - a.s;
    const t = span > 1e-9 ? (s - a.s) / span : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      s,
    };
  }

  tangentAt(distance: number): Point2 {
    const ahead = this.pointAt(distance + 1.25);
    const behind = this.pointAt(distance - 1.25);
    const dx = ahead.x - behind.x;
    const dz = ahead.z - behind.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: dx / length, z: dz / length };
  }

  /** Closest point on the sampled centre line, for map and coverage checks. */
  closest(x: number, z: number): { distance: number; s: number } {
    let best = Infinity;
    let bestS = 0;
    for (const sample of this.samples) {
      const d = (sample.x - x) ** 2 + (sample.z - z) ** 2;
      if (d < best) {
        best = d;
        bestS = sample.s;
      }
    }
    return { distance: Math.sqrt(best), s: bestS };
  }

  /** Signed lateral offset is positive to the right of travel direction. */
  lateralOffset(x: number, z: number, s: number): number {
    const point = this.pointAt(s);
    const tangent = this.tangentAt(s);
    const right = { x: -tangent.z, z: tangent.x };
    return (x - point.x) * right.x + (z - point.z) * right.z;
  }

  /** Minimum distance from a point to the route polyline. */
  distanceTo(x: number, z: number): number {
    let best = Infinity;
    for (const sample of this.samples) {
      const d = distanceSq({ x, y: 0, z }, { x: sample.x, y: 0, z: sample.z });
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
}

const catmullRom = (p0: Point2, p1: Point2, p2: Point2, p3: Point2, t: number): Point2 => {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z:
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
};
