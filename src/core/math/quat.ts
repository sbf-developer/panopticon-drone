import { type Vec3, V3, cross, normalize } from './vec3';

/** Unit quaternion, body-to-world orientation. */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const QUAT_IDENTITY: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export const quat = (x = 0, y = 0, z = 0, w = 1): Quat => ({ x, y, z, w });

export const quatNormalize = (q: Quat): Quat => {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  if (n < 1e-12) return QUAT_IDENTITY;
  const inv = 1 / n;
  return { x: q.x * inv, y: q.y * inv, z: q.z * inv, w: q.w * inv };
};

export const quatConjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

/** Hamilton product: result = a * b. */
export const quatMultiply = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

export const quatFromAxisAngle = (axis: Vec3, angle: number): Quat => {
  const n = normalize(axis);
  const s = Math.sin(angle / 2);
  return quat(n.x * s, n.y * s, n.z * s, Math.cos(angle / 2));
};

/** Rotation about world +Y. Positive is counter-clockwise viewed from above. */
export const quatFromYaw = (yaw: number): Quat =>
  quat(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));

/** Rotate a world/body vector by a unit quaternion. */
export const quatRotate = (q: Quat, v: Vec3): Vec3 => {
  // t = 2 * cross(q.xyz, v); v' = v + q.w * t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return V3(
    v.x + q.w * tx + (q.y * tz - q.z * ty),
    v.y + q.w * ty + (q.z * tx - q.x * tz),
    v.z + q.w * tz + (q.x * ty - q.y * tx),
  );
};

export const quatRotateInverse = (q: Quat, v: Vec3): Vec3 => quatRotate(quatConjugate(q), v);

export const quatFromBasis = (right: Vec3, up: Vec3, back: Vec3): Quat => {
  // Rotation matrix columns are the body axes expressed in world coordinates.
  const m00 = right.x;
  const m01 = up.x;
  const m02 = back.x;
  const m10 = right.y;
  const m11 = up.y;
  const m12 = back.y;
  const m20 = right.z;
  const m21 = up.z;
  const m22 = back.z;

  const trace = m00 + m11 + m22;
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 1;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = s / 4;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = s / 4;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = s / 4;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = s / 4;
  }

  return quatNormalize(quat(x, y, z, w));
};

/** Build an orientation whose body +Y axis points along `up` and whose
 * forward (-Z) axis is as close as possible to `forwardHint`. */
export const quatFromUpAndForward = (up: Vec3, forwardHint: Vec3): Quat => {
  const bodyUp = normalize(up);
  const hint = normalize(forwardHint);
  let right = normalize(cross(hint, bodyUp));
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) {
    right = normalize(cross(V3(0, 0, -1), bodyUp));
  }
  const back = normalize(cross(right, bodyUp));
  return quatFromBasis(right, bodyUp, back);
};

/**
 * Flight-display Euler angles for the body convention used here:
 * +X right, +Y up, +Z back. Yaw is about Y, pitch about X, roll about Z.
 */
export const quatToEuler = (q: Quat): { roll: number; pitch: number; yaw: number } => {
  const forward = quatRotate(q, V3(0, 0, -1));
  const right = quatRotate(q, V3(1, 0, 0));
  const up = quatRotate(q, V3(0, 1, 0));
  const yaw = Math.atan2(-forward.x, -forward.z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward.y)));
  const roll = Math.atan2(right.y, up.y);
  return { roll, pitch, yaw };
};

/** Quaternion from a rotation vector (axis * angle, body frame). */
export const quatFromRotationVector = (r: Vec3): Quat => {
  const angle = Math.hypot(r.x, r.y, r.z);
  if (angle < 1e-9) return quatNormalize(quat(r.x / 2, r.y / 2, r.z / 2, 1));
  return quatFromAxisAngle(r, angle);
};

/** Return the shortest rotation from `from` to `to` as a body-frame vector. */
export const quatErrorVector = (from: Quat, to: Quat): Vec3 => {
  const err = quatMultiply(quatConjugate(from), to);
  const q = err.w < 0 ? quat(-err.x, -err.y, -err.z, -err.w) : err;
  const vec = V3(q.x, q.y, q.z);
  const sinHalf = Math.hypot(vec.x, vec.y, vec.z);
  if (sinHalf < 1e-9) return V3();
  const angle = 2 * Math.atan2(sinHalf, q.w);
  return {
    x: (vec.x / sinHalf) * angle,
    y: (vec.y / sinHalf) * angle,
    z: (vec.z / sinHalf) * angle,
  };
};

/** Integrate orientation with body angular velocity for dt seconds. */
export const quatIntegrate = (q: Quat, omegaBody: Vec3, dt: number): Quat => {
  const omega: Quat = {
    x: omegaBody.x,
    y: omegaBody.y,
    z: omegaBody.z,
    w: 0,
  };
  const dq = quatMultiply(q, omega);
  return quatNormalize(
    quat(
      q.x + 0.5 * dq.x * dt,
      q.y + 0.5 * dq.y * dt,
      q.z + 0.5 * dq.z * dt,
      q.w + 0.5 * dq.w * dt,
    ),
  );
};

export const slerp = (a: Quat, b: Quat, t: number): Quat => {
  let cos = dotQuat(a, b);
  let target = b;
  if (cos < 0) {
    cos = -cos;
    target = quat(-b.x, -b.y, -b.z, -b.w);
  }
  if (cos > 0.9995) {
    return quatNormalize(
      quat(
        a.x + (target.x - a.x) * t,
        a.y + (target.y - a.y) * t,
        a.z + (target.z - a.z) * t,
        a.w + (target.w - a.w) * t,
      ),
    );
  }
  const theta = Math.acos(cos);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return quatNormalize(
    quat(
      a.x * wa + target.x * wb,
      a.y * wa + target.y * wb,
      a.z * wa + target.z * wb,
      a.w * wa + target.w * wb,
    ),
  );
};

export const dotQuat = (a: Quat, b: Quat): number =>
  a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
