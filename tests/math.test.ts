import { describe, expect, it } from 'vitest';
import {
  V3,
  compassDegrees,
  clamp,
  distance,
  wrapPi,
} from '../src/core/math/vec3';
import {
  quatErrorVector,
  quatFromBasis,
  quatFromUpAndForward,
  quatFromYaw,
  quatRotate,
  quatToEuler,
} from '../src/core/math/quat';
import { diagonal, identity } from '../src/core/math/matrix';
import { inverseCheck } from './matrixTestUtils';

describe('vector and angle helpers', () => {
  it('wraps angles to the shortest interval', () => {
    expect(Math.abs(wrapPi(Math.PI * 3))).toBeCloseTo(Math.PI, 6);
    expect(Math.abs(wrapPi(-Math.PI * 3))).toBeCloseTo(Math.PI, 6);
    expect(wrapPi(0.4)).toBeCloseTo(0.4, 9);
  });

  it('maps the north-facing yaw convention to compass degrees', () => {
    expect(compassDegrees(0)).toBeCloseTo(0, 6);
    expect(compassDegrees(-Math.PI / 2)).toBeCloseTo(90, 6);
    expect(compassDegrees(Math.PI / 2)).toBeCloseTo(270, 6);
  });

  it('clamps reliably at both ends', () => {
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(distance(V3(), V3(3, 4, 0))).toBeCloseTo(5, 9);
  });
});

describe('quaternion conventions', () => {
  it('rotates body axes consistently', () => {
    const yaw = quatFromYaw(Math.PI / 2);
    const forward = quatRotate(yaw, V3(0, 0, -1));
    expect(forward.x).toBeCloseTo(-1, 6);
    expect(forward.z).toBeCloseTo(0, 6);
    const up = quatRotate(yaw, V3(0, 1, 0));
    expect(up.y).toBeCloseTo(1, 6);
  });

  it('builds an orientation from an up vector and heading', () => {
    const orientation = quatFromUpAndForward(V3(0, 1, 0), V3(1, 0, 0));
    const forward = quatRotate(orientation, V3(0, 0, -1));
    expect(forward.x).toBeCloseTo(1, 6);
    expect(forward.y).toBeCloseTo(0, 6);
    const euler = quatToEuler(orientation);
    expect(compassDegrees(euler.yaw)).toBeCloseTo(90, 5);
    expect(Math.abs(euler.roll)).toBeLessThan(1e-5);
  });

  it('returns a zero correction for identical attitudes', () => {
    const q = quatFromUpAndForward(V3(0.2, 1, 0.1), V3(-1, 0, 0));
    const correction = quatErrorVector(q, q);
    expect(Math.hypot(correction.x, correction.y, correction.z)).toBeLessThan(1e-7);
  });

  it('round-trips a rotation matrix basis', () => {
    const q = quatFromYaw(0.71);
    const right = quatRotate(q, V3(1, 0, 0));
    const up = quatRotate(q, V3(0, 1, 0));
    const back = quatRotate(q, V3(0, 0, 1));
    const rebuilt = quatFromBasis(right, up, back);
    const correction = quatErrorVector(rebuilt, q);
    expect(Math.hypot(correction.x, correction.y, correction.z)).toBeLessThan(1e-6);
  });
});

describe('matrix utilities', () => {
  it('inverts a known 6x6 covariance-like matrix', () => {
    const matrix = diagonal([2, 3, 4, 5, 6, 7]);
    const result = inverseCheck(matrix);
    expect(result).toBe(true);
    expect(identity(3)[2]![2]).toBe(1);
  });
});
