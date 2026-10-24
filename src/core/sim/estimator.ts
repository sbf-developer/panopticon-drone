import {
  type Vec3,
  V3,
  add,
  clamp,
  length,
  normalize,
  scale,
  sub,
  wrapPi,
} from '../math/vec3';
import {
  type Quat,
  quatFromYaw,
  quatIntegrate,
  quatRotate,
  quatRotateInverse,
  quatToEuler,
} from '../math/quat';
import {
  type Matrix,
  add as matAdd,
  diagonal,
  identity,
  invert,
  multiply,
  subtract,
  symmetrize,
  transpose,
  zeros,
} from '../math/matrix';

const GRAVITY = 9.80665;
const WORLD_MAG = normalize(V3(0, -0.36, -0.93));

/** A small linear Kalman filter with Joseph-form covariance updates. */
export class LinearKalmanFilter {
  state: number[];
  covariance: Matrix;

  constructor(state: number[], covariance: Matrix) {
    this.state = [...state];
    this.covariance = covariance.map((row) => [...row]);
  }

  predict(F: Matrix, Q: Matrix): void {
    this.state = multiply(F, this.state.map((value) => [value])).map((row) => row[0]!);
    this.covariance = matAdd(multiply(multiply(F, this.covariance), transpose(F)), Q);
    this.covariance = symmetrize(this.covariance);
  }

  update(z: number[], H: Matrix, R: Matrix): { nis: number; accepted: boolean } {
    const n = this.state.length;
    const x = this.state.map((value) => [value]);
    const Hx = multiply(H, x);
    const innovation = z.map((value, i) => value - Hx[i]![0]!);
    const PHt = multiply(this.covariance, transpose(H));
    const S = matAdd(multiply(H, PHt), R);
    let SInv: Matrix;
    try {
      SInv = invert(S);
    } catch {
      return { nis: 0, accepted: false };
    }
    const K = multiply(PHt, SInv);
    const correction = multiply(K, innovation.map((value) => [value]));
    this.state = this.state.map((value, i) => value + correction[i]![0]!);

    const I = identity(n);
    const KH = multiply(K, H);
    const IKH = subtract(I, KH);
    this.covariance = matAdd(
      multiply(multiply(IKH, this.covariance), transpose(IKH)),
      multiply(multiply(K, R), transpose(K)),
    );
    this.covariance = symmetrize(this.covariance);

    const nis = dotMatrix(innovation, multiply(SInv, innovation.map((value) => [value])));
    return { nis, accepted: true };
  }
}

const dotMatrix = (vector: number[], matrix: Matrix): number => {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    for (let j = 0; j < vector.length; j += 1) {
      sum += vector[i]! * matrix[i]![j]! * vector[j]!;
    }
  }
  return sum;
};

const constantVelocityF = (dt: number): Matrix => {
  const F = identity(6);
  F[0]![3] = dt;
  F[1]![4] = dt;
  F[2]![5] = dt;
  return F;
};

const constantVelocityQ = (dt: number, accelStd: number): Matrix => {
  const q = zeros(6, 6);
  const a2 = accelStd * accelStd;
  const qPos = (a2 * dt ** 3) / 3;
  const qCross = (a2 * dt ** 2) / 2;
  const qVel = a2 * dt;
  for (let axis = 0; axis < 3; axis += 1) {
    q[axis]![axis] = qPos;
    q[axis]![axis + 3] = qCross;
    q[axis + 3]![axis] = qCross;
    q[axis + 3]![axis + 3] = qVel;
  }
  return q;
};

/**
 * Mahony-style complementary attitude filter. Gyro drives the prediction;
 * accelerometer and magnetometer provide gravity and heading corrections.
 */
export class AttitudeEstimator {
  orientation: Quat = quatFromYaw(0);
  private integral = V3();
  initialized = false;
  accelRejected = false;
  magRejected = false;

  reset(): void {
    this.orientation = quatFromYaw(0);
    this.integral = V3();
    this.initialized = false;
  }

  update(
    gyro: Vec3,
    accel: Vec3,
    mag: Vec3 | null,
    dt: number,
    accelerationAiding: Vec3 = V3(),
  ): Quat {
    if (!this.initialized) {
      const initialYaw = mag && length(mag) > 0.1 ? Math.atan2(mag.x, -mag.z) : 0;
      this.orientation = quatFromYaw(initialYaw);
      this.initialized = true;
      return this.orientation;
    }

    const error = { x: 0, y: 0, z: 0 };
    // Accelerometers measure specific force, f = a - g. Subtracting an
    // independent translational-acceleration estimate (from the GPS/IMU
    // navigation filter) recovers gravity, but that correction is only trusted
    // in quasi-static flight. In manoeuvres the gyro is the primary attitude
    // reference, which is also how lightweight real-world AHRS units behave.
    const specificForceWorld = quatRotate(this.orientation, accel);
    const gravityWorld = sub(accelerationAiding, specificForceWorld);
    const gravityMagnitude = length(gravityWorld);
    const accelerationMagnitude = length(accelerationAiding);
    const rateMagnitude = length(gyro);
    const specificForceMagnitude = length(accel);
    const estimatedUpBody = quatRotateInverse(this.orientation, V3(0, 1, 0));
    const estimatedTilt = Math.acos(clamp(estimatedUpBody.y, -1, 1));
    const quasiStatic =
      accelerationMagnitude < 0.75 &&
      rateMagnitude < 0.38 &&
      Math.abs(specificForceMagnitude - 9.80665) < 0.65 &&
      estimatedTilt < 0.24;
    this.accelRejected = !quasiStatic || gravityMagnitude < 7.4 || gravityMagnitude > 12.8;
    if (!this.accelRejected) {
      const measuredDownBody = quatRotateInverse(
        this.orientation,
        scale(gravityWorld, 1 / gravityMagnitude),
      );
      const estimatedDownBody = V3(0, -1, 0);
      const accelError = crossSafe(measuredDownBody, estimatedDownBody);
      error.x += accelError.x * 0.8;
      error.y += accelError.y * 0.8;
      error.z += accelError.z * 0.8;
    }

    this.magRejected = !mag || length(mag) < 0.1;
    if (mag && length(mag) > 0.1 && estimatedTilt < 0.16 && rateMagnitude < 0.55) {
      // Magnetic heading is only used near level flight. During a banked
      // manoeuvre a small tilt-estimate error leaks into apparent heading and
      // would drive a spurious roll/pitch correction.
      const measuredWorld = quatRotate(this.orientation, normalize(mag));
      const measuredYaw = Math.atan2(measuredWorld.x, -measuredWorld.z);
      const referenceYaw = Math.atan2(WORLD_MAG.x, -WORLD_MAG.z);
      const headingError = wrapPi(referenceYaw - measuredYaw);
      const headingErrorBody = quatRotateInverse(this.orientation, V3(0, headingError, 0));
      error.x += headingErrorBody.x * 0.05;
      error.y += headingErrorBody.y * 0.05;
      error.z += headingErrorBody.z * 0.05;
    }

    const kp = 0.4;
    const ki = 0.02;
    this.integral = add(this.integral, scale(error, ki * dt));
    this.integral = clampVectorLength(this.integral, 0.08);
    const correctedGyro = add(gyro, add(scale(error, kp), this.integral));
    this.orientation = quatIntegrate(this.orientation, correctedGyro, dt);
    return this.orientation;
  }

  euler(): { roll: number; pitch: number; yaw: number } {
    return quatToEuler(this.orientation);
  }
}

const crossSafe = (a: Vec3, b: Vec3): Vec3 =>
  V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

const clampVectorLength = (vector: Vec3, max: number): Vec3 => {
  const l = length(vector);
  return l > max ? scale(vector, max / l) : vector;
};

export interface NavigationEstimate {
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
  angularVelocity: Vec3;
  positionSigma: number;
  velocitySigma: number;
  gpsNis: number;
}

/**
 * Six-state navigation filter (position + velocity). IMU specific force is
 * propagated with the attitude estimate; GPS and barometer correct position.
 * This is a deliberately lightweight analogue of an EKF, not a full 15-state
 * attitude/velocity/position estimator.
 */
export class NavigationFilter {
  private kf: LinearKalmanFilter;
  orientation: Quat = quatFromYaw(0);
  gpsNis = 0;
  baroNis = 0;
  lastGpsTime = -Infinity;

  constructor(initialPosition: Vec3) {
    this.kf = new LinearKalmanFilter(
      [initialPosition.x, initialPosition.y, initialPosition.z, 0, 0, 0],
      diagonal([1.2, 1.2, 1.6, 0.9, 0.9, 1.2]),
    );
  }

  reset(initialPosition: Vec3): void {
    this.kf = new LinearKalmanFilter(
      [initialPosition.x, initialPosition.y, initialPosition.z, 0, 0, 0],
      diagonal([1.2, 1.2, 1.6, 0.9, 0.9, 1.2]),
    );
    this.gpsNis = 0;
    this.baroNis = 0;
    this.lastGpsTime = -Infinity;
  }

  predict(specificForceBody: Vec3, orientation: Quat, dt: number): void {
    this.orientation = orientation;
    const forceWorld = quatRotate(orientation, specificForceBody);
    const acceleration = V3(forceWorld.x, forceWorld.y - GRAVITY, forceWorld.z);
    const F = constantVelocityF(dt);
    const Q = constantVelocityQ(dt, 0.58);
    this.kf.predict(F, Q);
    const p = this.kf.state;
    // F has already propagated position with the previous velocity. Add only
    // the acceleration contribution here (the second-order term).
    p[0] = p[0]! + 0.5 * acceleration.x * dt * dt;
    p[1] = p[1]! + 0.5 * acceleration.y * dt * dt;
    p[2] = p[2]! + 0.5 * acceleration.z * dt * dt;
    p[3] = p[3]! + acceleration.x * dt;
    p[4] = p[4]! + acceleration.y * dt;
    p[5] = p[5]! + acceleration.z * dt;
  }

  updateGps(position: Vec3, covariance: Vec3, time: number): void {
    const H = zeros(3, 6);
    H[0]![0] = 1;
    H[1]![1] = 1;
    H[2]![2] = 1;
    const R = diagonal([covariance.x, covariance.y, covariance.z]);
    const { nis } = this.kf.update([position.x, position.y, position.z], H, R);
    this.gpsNis = nis;
    this.lastGpsTime = time;
  }

  updateBarometer(altitude: number, variance: number): void {
    const H = zeros(1, 6);
    H[0]![1] = 1;
    const { nis } = this.kf.update([altitude], H, diagonal([variance]));
    this.baroNis = nis;
  }

  estimate(orientation: Quat, angularVelocity: Vec3): NavigationEstimate {
    const p = this.kf.state;
    return {
      position: V3(p[0]!, p[1]!, p[2]!),
      velocity: V3(p[3]!, p[4]!, p[5]!),
      orientation,
      angularVelocity,
      positionSigma: Math.sqrt(
        Math.max(0, this.kf.covariance[0]![0]! + this.kf.covariance[2]![2]!),
      ),
      velocitySigma: Math.sqrt(
        Math.max(0, this.kf.covariance[3]![3]! + this.kf.covariance[5]![5]!),
      ),
      gpsNis: this.gpsNis,
    };
  }

  get state(): number[] {
    return this.kf.state;
  }
}

export type TargetTrackStatus = 'SEARCHING' | 'ACQUIRING' | 'TRACKING' | 'COASTING' | 'LOST';

export interface TargetTrack {
  position: Vec3;
  velocity: Vec3;
  status: TargetTrackStatus;
  age: number;
  timeSinceUpdate: number;
  confidence: number;
  covarianceTrace: number;
  updates: number;
  nis: number;
  initialized: boolean;
}

/**
 * Constant-velocity target filter operating on camera/laser measurements. The
 * mission layer consumes this estimate only; simulator truth never enters.
 */
export class TargetTracker {
  private kf: LinearKalmanFilter | null = null;
  private lastUpdateTime = -Infinity;
  private firstUpdateTime = -Infinity;
  private updates = 0;
  private rejected = 0;
  private lastNis = 0;

  reset(): void {
    this.kf = null;
    this.lastUpdateTime = -Infinity;
    this.firstUpdateTime = -Infinity;
    this.updates = 0;
    this.rejected = 0;
    this.lastNis = 0;
  }

  predict(dt: number, now: number): void {
    if (!this.kf) return;
    this.kf.predict(constantVelocityF(dt), constantVelocityQ(dt, 2.2));
    if (now - this.lastUpdateTime > 5.5) this.reset();
  }

  update(position: Vec3, variance: Vec3, now: number): boolean {
    if (!this.kf) {
      this.kf = new LinearKalmanFilter(
        [position.x, position.y, position.z, 0, 0, 0],
        diagonal([9, 9, 12, 36, 36, 49]),
      );
      this.lastUpdateTime = now;
      this.firstUpdateTime = now;
      this.updates = 1;
      return true;
    }
    const innovation = V3(
      position.x - this.kf.state[0]!,
      position.y - this.kf.state[1]!,
      position.z - this.kf.state[2]!,
    );
    const gate = Math.sqrt(variance.x + variance.z) * 5.5 + 2;
    if (length(innovation) > gate) {
      this.rejected += 1;
      return false;
    }
    const H = zeros(3, 6);
    H[0]![0] = 1;
    H[1]![1] = 1;
    H[2]![2] = 1;
    const R = diagonal([variance.x, variance.y, variance.z]);
    const { nis, accepted } = this.kf.update([position.x, position.y, position.z], H, R);
    if (!accepted) return false;
    this.lastNis = nis;
    this.lastUpdateTime = now;
    this.updates += 1;
    const maxSpeed = 36;
    this.kf.state[3] = clamp(this.kf.state[3]!, -maxSpeed, maxSpeed);
    this.kf.state[5] = clamp(this.kf.state[5]!, -maxSpeed, maxSpeed);
    return true;
  }

  track(now: number): TargetTrack {
    if (!this.kf) {
      return {
        position: V3(),
        velocity: V3(),
        status: 'SEARCHING',
        age: 0,
        timeSinceUpdate: 99,
        confidence: 0,
        covarianceTrace: Infinity,
        updates: 0,
        nis: 0,
        initialized: false,
      };
    }
    const state = this.kf.state;
    const covariance = this.kf.covariance;
    const covarianceTrace =
      covariance[0]![0]! + covariance[2]![2]! + covariance[3]![3]! + covariance[5]![5]!;
    const timeSinceUpdate = Math.min(99, now - this.lastUpdateTime);
    const age = now - this.firstUpdateTime;
    let status: TargetTrackStatus;
    if (timeSinceUpdate > 2.6) status = 'LOST';
    else if (timeSinceUpdate > 0.42) status = 'COASTING';
    else if (this.updates < 3 || age < 0.35) status = 'ACQUIRING';
    else status = 'TRACKING';

    const confidence = clamp(
      1 - covarianceTrace / 55 - Math.min(timeSinceUpdate, 2.5) * 0.12 - this.rejected * 0.002,
      0.02,
      1,
    );
    return {
      position: V3(state[0]!, state[1]!, state[2]!),
      velocity: V3(state[3]!, state[4]!, state[5]!),
      status,
      age,
      timeSinceUpdate,
      confidence,
      covarianceTrace,
      updates: this.updates,
      nis: this.lastNis,
      initialized: true,
    };
  }

  get isInitialized(): boolean {
    return this.kf !== null;
  }
}

export const WORLD_MAGNETIC_FIELD = WORLD_MAG;
