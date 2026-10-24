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
  quatFromAxisAngle,
  quatFromYaw,
  quatMultiply,
  quatNormalize,
  quatRotate,
  quatRotateInverse,
} from '../math/quat';
import { Rng } from '../math/random';
import { WORLD_MAGNETIC_FIELD } from './estimator';
import type { World } from '../world/environment';

export interface ImuSample {
  time: number;
  gyro: Vec3;
  accel: Vec3;
}

export interface GpsSample {
  time: number;
  position: Vec3;
  variance: Vec3;
  satellites: number;
  hdop: number;
}

export interface BaroSample {
  time: number;
  altitude: number;
  variance: number;
}

export interface MagSample {
  time: number;
  field: Vec3;
}

export interface GimbalPose {
  position: Vec3;
  orientation: Quat;
  yaw: number;
  pitch: number;
  forward: Vec3;
  up: Vec3;
  right: Vec3;
  fovHorizontal: number;
  fovVertical: number;
}

export interface TargetDetection {
  time: number;
  visible: boolean;
  inFov: boolean;
  occluded: boolean;
  tooFar: boolean;
  range: number;
  bearing: number;
  elevation: number;
  position: Vec3;
  variance: Vec3;
  screenX: number;
  screenY: number;
  confidence: number;
  laserValid: boolean;
}

/** World-stabilised three-axis camera gimbal with rate-limited slew. */
export class Gimbal {
  yaw: number;
  pitch: number;
  yawRate = 0;
  pitchRate = 0;
  readonly maxYawRate = 1.8;
  readonly maxPitchRate = 1.2;
  readonly fovHorizontal: number;
  readonly fovVertical: number;
  private readonly mountOffset = V3(0, -0.06, -0.42);

  constructor(initialYaw: number, fovHorizontalDeg = 38, aspect = 16 / 9) {
    this.yaw = initialYaw;
    this.pitch = -0.08;
    this.fovHorizontal = (fovHorizontalDeg * Math.PI) / 180;
    const vertical = 2 * Math.atan(Math.tan(this.fovHorizontal / 2) / aspect);
    this.fovVertical = vertical;
  }

  reset(initialYaw: number): void {
    this.yaw = initialYaw;
    this.pitch = -0.08;
    this.yawRate = 0;
    this.pitchRate = 0;
  }

  update(dronePosition: Vec3, droneOrientation: Quat, aimPoint: Vec3, dt: number): GimbalPose {
    const mount = quatRotate(droneOrientation, this.mountOffset);
    const position = add(dronePosition, mount);
    const rel = sub(aimPoint, position);
    const horizontal = Math.hypot(rel.x, rel.z);
    const desiredYaw = Math.atan2(-rel.x, -rel.z);
    const desiredPitch = Math.atan2(rel.y, Math.max(horizontal, 0.5));
    const yawError = wrapPi(desiredYaw - this.yaw);
    const pitchError = desiredPitch - this.pitch;

    const desiredYawRate = clamp(yawError * 3.4, -this.maxYawRate, this.maxYawRate);
    const desiredPitchRate = clamp(pitchError * 3.8, -this.maxPitchRate, this.maxPitchRate);
    const alpha = 1 - Math.exp(-dt * 8);
    this.yawRate += (desiredYawRate - this.yawRate) * alpha;
    this.pitchRate += (desiredPitchRate - this.pitchRate) * alpha;
    this.yaw = wrapPi(this.yaw + this.yawRate * dt);
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -1.45, 0.6);

    const orientation = cameraOrientation(this.yaw, this.pitch);
    return {
      position,
      orientation,
      yaw: this.yaw,
      pitch: this.pitch,
      forward: quatRotate(orientation, V3(0, 0, -1)),
      up: quatRotate(orientation, V3(0, 1, 0)),
      right: quatRotate(orientation, V3(1, 0, 0)),
      fovHorizontal: this.fovHorizontal,
      fovVertical: this.fovVertical,
    };
  }

  lookAtImmediate(dronePosition: Vec3, droneOrientation: Quat, aimPoint: Vec3): void {
    const position = add(dronePosition, quatRotate(droneOrientation, this.mountOffset));
    const rel = sub(aimPoint, position);
    this.yaw = Math.atan2(-rel.x, -rel.z);
    this.pitch = clamp(Math.atan2(rel.y, Math.max(Math.hypot(rel.x, rel.z), 0.5)), -1.45, 0.6);
  }
}

export const cameraOrientation = (yaw: number, pitch: number): Quat =>
  quatNormalize(quatMultiply(quatFromYaw(yaw), quatFromAxisAngle(V3(1, 0, 0), pitch)));

const localRay = (azimuth: number, elevation: number): Vec3 => {
  const cosEl = Math.cos(elevation);
  return V3(Math.sin(azimuth) * cosEl, Math.sin(elevation), -Math.cos(azimuth) * cosEl);
};

/** Monocular detection with a co-boresighted laser rangefinder. */
export class TargetDetector {
  readonly resolution = { width: 1280, height: 720 };
  readonly maxRange = 165;
  private readonly rng: Rng;
  private readonly angularSigma = 0.0018;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x7f4a7c15);
  }

  detect(
    targetPoint: Vec3,
    gimbal: GimbalPose,
    world: World,
    time: number,
  ): TargetDetection {
    const rel = sub(targetPoint, gimbal.position);
    const range = length(rel);
    const relativeCamera = quatRotateInverse(gimbal.orientation, rel);
    const forwardDistance = -relativeCamera.z;
    const horizontal = Math.hypot(relativeCamera.x, relativeCamera.z);
    const azimuth = Math.atan2(relativeCamera.x, Math.max(forwardDistance, 1e-6));
    const elevation = Math.atan2(relativeCamera.y, Math.max(horizontal, 1e-6));
    const inFov =
      forwardDistance > 0 &&
      Math.abs(azimuth) <= gimbal.fovHorizontal / 2 &&
      Math.abs(elevation) <= gimbal.fovVertical / 2;
    const occluded = world.segmentBlocked(gimbal.position, targetPoint, 0);
    const tooFar = range > this.maxRange;
    const visible = inFov && !occluded && !tooFar && range > 2.5;

    const laserValid = visible && this.rng.chance(0.965);
    if (!visible) {
      return {
        time,
        visible: false,
        inFov,
        occluded,
        tooFar,
        range,
        bearing: azimuth,
        elevation,
        position: V3(),
        variance: V3(10, 10, 10),
        screenX: clamp(azimuth / gimbal.fovHorizontal + 0.5, 0, 1),
        screenY: clamp(0.5 - elevation / gimbal.fovVertical, 0, 1),
        confidence: 0,
        laserValid,
      };
    }

    const measuredAz = azimuth + this.rng.normal(0, this.angularSigma);
    const measuredEl = elevation + this.rng.normal(0, this.angularSigma);
    const measuredRange = range + this.rng.normal(0, 0.22 + range * 0.004);
    const direction = quatRotate(gimbal.orientation, localRay(measuredAz, measuredEl));
    const position = add(gimbal.position, scale(normalize(direction), measuredRange));
    const lateralSigma = 0.28 + this.angularSigma * range * 1.7;
    const verticalSigma = 0.38 + this.angularSigma * range * 2.1;
    const confidence = clamp(1 - range / this.maxRange, 0.1, 0.98);

    return {
      time,
      visible: true,
      inFov,
      occluded,
      tooFar,
      range,
      bearing: azimuth,
      elevation,
      position,
      variance: V3(lateralSigma ** 2, verticalSigma ** 2, lateralSigma ** 2),
      screenX: clamp(azimuth / gimbal.fovHorizontal + 0.5, 0, 1),
      screenY: clamp(0.5 - elevation / gimbal.fovVertical, 0, 1),
      confidence,
      laserValid,
    };
  }
}

/** Noise models for the onboard inertial/position sensors. */
export class SensorModels {
  private readonly rng: Rng;
  private gyroBias: Vec3;
  private accelBias: Vec3;
  private gpsBias: Vec3;
  private multipath = V3();

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x2545f491);
    this.gyroBias = V3(
      this.rng.normal(0, 0.0006),
      this.rng.normal(0, 0.0006),
      this.rng.normal(0, 0.0006),
    );
    this.accelBias = V3(
      this.rng.normal(0, 0.028),
      this.rng.normal(0, 0.028),
      this.rng.normal(0, 0.028),
    );
    this.gpsBias = V3(
      this.rng.normal(0, 0.22),
      0,
      this.rng.normal(0, 0.22),
    );
  }

  reset(): void {
    this.gyroBias = V3(
      this.rng.normal(0, 0.0006),
      this.rng.normal(0, 0.0006),
      this.rng.normal(0, 0.0006),
    );
    this.accelBias = V3(
      this.rng.normal(0, 0.028),
      this.rng.normal(0, 0.028),
      this.rng.normal(0, 0.028),
    );
    this.multipath = V3();
  }

  imu(time: number, specificForceBody: Vec3, angularVelocity: Vec3, dt: number): ImuSample {
    const walk = Math.sqrt(dt);
    this.gyroBias = V3(
      this.gyroBias.x + this.rng.normal(0, 0.00003) * walk,
      this.gyroBias.y + this.rng.normal(0, 0.00003) * walk,
      this.gyroBias.z + this.rng.normal(0, 0.00003) * walk,
    );
    this.accelBias = V3(
      this.accelBias.x + this.rng.normal(0, 0.0012) * walk,
      this.accelBias.y + this.rng.normal(0, 0.0012) * walk,
      this.accelBias.z + this.rng.normal(0, 0.0012) * walk,
    );
    return {
      time,
      gyro: V3(
        angularVelocity.x + this.gyroBias.x + this.rng.normal(0, 0.0011),
        angularVelocity.y + this.gyroBias.y + this.rng.normal(0, 0.0011),
        angularVelocity.z + this.gyroBias.z + this.rng.normal(0, 0.0011),
      ),
      accel: V3(
        specificForceBody.x + this.accelBias.x + this.rng.normal(0, 0.035),
        specificForceBody.y + this.accelBias.y + this.rng.normal(0, 0.035),
        specificForceBody.z + this.accelBias.z + this.rng.normal(0, 0.035),
      ),
    };
  }

  gps(time: number, truth: Vec3, dt: number): GpsSample {
    const tau = 7;
    const alpha = 1 - Math.exp(-dt / tau);
    this.multipath = V3(
      this.multipath.x + (this.rng.normal(0, 0.28) - this.multipath.x) * alpha,
      this.multipath.y + (this.rng.normal(0, 0.2) - this.multipath.y) * alpha,
      this.multipath.z + (this.rng.normal(0, 0.28) - this.multipath.z) * alpha,
    );
    return {
      time,
      position: V3(
        truth.x + this.gpsBias.x + this.multipath.x + this.rng.normal(0, 0.24),
        truth.y + this.multipath.y + this.rng.normal(0, 0.5),
        truth.z + this.gpsBias.z + this.multipath.z + this.rng.normal(0, 0.24),
      ),
      variance: V3(0.34 ** 2, 0.72 ** 2, 0.34 ** 2),
      satellites: this.rng.int(14, 19),
      hdop: 0.7 + this.rng.next() * 0.4,
    };
  }

  barometer(time: number, truthAltitude: number): BaroSample {
    return {
      time,
      altitude: truthAltitude + this.rng.normal(0, 0.18),
      variance: 0.18 ** 2,
    };
  }

  magnetometer(time: number, orientation: Quat): MagSample {
    const field = quatRotateInverse(orientation, WORLD_MAGNETIC_FIELD);
    return {
      time,
      field: V3(
        field.x + this.rng.normal(0, 0.005),
        field.y + this.rng.normal(0, 0.005),
        field.z + this.rng.normal(0, 0.005),
      ),
    };
  }
}
