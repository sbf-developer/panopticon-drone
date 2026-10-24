import {
  type Vec3,
  V3,
  UP,
  add,
  addScaled,
  clamp,
  clampLength,
  dot,
  horizontalLength,
  normalize,
  scale,
} from '../math/vec3';
import { type Quat, quatErrorVector, quatFromUpAndForward, quatRotate } from '../math/quat';
import { DEFAULT_DRONE_PARAMETERS } from './drone';

export interface FlightCommand {
  position: Vec3;
  velocity: Vec3;
  acceleration: Vec3;
  yaw: number;
  yawRate: number;
}

export interface EstimatedFlightState {
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
  angularVelocity: Vec3;
}

export interface ControlOutput {
  thrust: number;
  torque: Vec3;
  desiredOrientation: Quat;
  desiredAngularVelocity: Vec3;
  positionError: Vec3;
  velocityError: Vec3;
  saturated: boolean;
}

export interface ControllerGains {
  positionKp: number;
  maxHorizontalSpeed: number;
  maxVerticalSpeed: number;
  velocityKp: number;
  velocityKi: number;
  maxHorizontalAcceleration: number;
  maxVerticalAcceleration: number;
  attitudeKp: number;
  maxBodyRate: number;
  rateKp: Vec3;
  rateKi: Vec3;
  maxTorque: Vec3;
  maxTilt: number;
}

export const DEFAULT_CONTROLLER_GAINS: ControllerGains = {
  positionKp: 0.82,
  maxHorizontalSpeed: 24,
  maxVerticalSpeed: 5.5,
  velocityKp: 2.9,
  velocityKi: 0.38,
  maxHorizontalAcceleration: 8.2,
  maxVerticalAcceleration: 4.2,
  attitudeKp: 6.4,
  maxBodyRate: 6.2,
  rateKp: V3(0.26, 0.19, 0.26),
  rateKi: V3(0.035, 0.022, 0.035),
  maxTorque: V3(1.05, 0.45, 1.05),
  maxTilt: DEFAULT_DRONE_PARAMETERS.maxTiltRad,
};

export const zeroCommand = (position: Vec3, yaw = 0): FlightCommand => ({
  position,
  velocity: V3(),
  acceleration: V3(),
  yaw,
  yawRate: 0,
});

/**
 * Cascaded PX4-style flight controller:
 * position P -> velocity PI -> thrust vector -> attitude P -> body-rate PI.
 * It intentionally runs on estimated state only, never on simulator truth.
 */
export class FlightController {
  readonly gains: ControllerGains;
  private velocityIntegral: Vec3 = V3();
  private rateIntegral: Vec3 = V3();
  private previousRateError: Vec3 = V3();
  enabled = true;

  constructor(gains: Partial<ControllerGains> = {}) {
    this.gains = { ...DEFAULT_CONTROLLER_GAINS, ...gains };
    this.reset();
  }

  reset(): void {
    this.velocityIntegral = V3();
    this.rateIntegral = V3();
    this.previousRateError = V3();
  }

  update(
    state: EstimatedFlightState,
    command: FlightCommand,
    dt: number,
    droneMass = DEFAULT_DRONE_PARAMETERS.mass,
  ): ControlOutput {
    const g = this.gains;
    if (!this.enabled) {
      this.reset();
      return {
        thrust: 0,
        torque: V3(),
        desiredOrientation: state.orientation,
        desiredAngularVelocity: V3(),
        positionError: V3(),
        velocityError: V3(),
        saturated: false,
      };
    }

    const positionError = clampLength(
      {
        x: command.position.x - state.position.x,
        y: command.position.y - state.position.y,
        z: command.position.z - state.position.z,
      },
      45,
    );
    const velocityTarget = clampLength(
      {
        x: positionError.x * g.positionKp + command.velocity.x,
        y: positionError.y * g.positionKp + command.velocity.y,
        z: positionError.z * g.positionKp + command.velocity.z,
      },
      g.maxHorizontalSpeed,
    );
    // Preserve the vertical command independently so altitude cannot be
    // starved by horizontal speed limiting.
    const verticalTarget = clamp(
      positionError.y * g.positionKp + command.velocity.y,
      -g.maxVerticalSpeed,
      g.maxVerticalSpeed,
    );
    const velocityTargetWithY = V3(velocityTarget.x, verticalTarget, velocityTarget.z);
    const velocityError = {
      x: velocityTargetWithY.x - state.velocity.x,
      y: velocityTargetWithY.y - state.velocity.y,
      z: velocityTargetWithY.z - state.velocity.z,
    };

    this.velocityIntegral = addScaled(
      this.velocityIntegral,
      scale(velocityError, g.velocityKi * dt),
      1,
    );
    this.velocityIntegral = clampLength(
      this.velocityIntegral,
      g.maxHorizontalAcceleration * 0.28,
    );

    let accelDesired = add(
      add(scale(velocityError, g.velocityKp), this.velocityIntegral),
      command.acceleration,
    );
    const horizontal = V3(accelDesired.x, 0, accelDesired.z);
    const clampedHorizontal = clampLength(horizontal, g.maxHorizontalAcceleration);
    accelDesired = V3(
      clampedHorizontal.x,
      clamp(accelDesired.y, -g.maxVerticalAcceleration, g.maxVerticalAcceleration),
      clampedHorizontal.z,
    );

    const force = scale(add(accelDesired, scale(UP, 9.80665)), droneMass);
    const forceDir = clampTilt(force, g.maxTilt);
    const desiredOrientation = quatFromUpAndForward(forceDir, {
      x: -Math.sin(command.yaw),
      y: 0,
      z: -Math.cos(command.yaw),
    });

    const attitudeError = quatErrorVector(state.orientation, desiredOrientation);
    let desiredRate = scale(attitudeError, g.attitudeKp);
    desiredRate = V3(
      clamp(desiredRate.x, -g.maxBodyRate, g.maxBodyRate),
      clamp(desiredRate.y + command.yawRate, -g.maxBodyRate, g.maxBodyRate),
      clamp(desiredRate.z, -g.maxBodyRate, g.maxBodyRate),
    );

    const rateError = {
      x: desiredRate.x - state.angularVelocity.x,
      y: desiredRate.y - state.angularVelocity.y,
      z: desiredRate.z - state.angularVelocity.z,
    };
    this.rateIntegral = addScaled(this.rateIntegral, scale(rateError, dt), 1);
    this.rateIntegral = V3(
      clamp(this.rateIntegral.x, -0.12, 0.12),
      clamp(this.rateIntegral.y, -0.08, 0.08),
      clamp(this.rateIntegral.z, -0.12, 0.12),
    );
    const derivative = scale(
      {
        x: rateError.x - this.previousRateError.x,
        y: rateError.y - this.previousRateError.y,
        z: rateError.z - this.previousRateError.z,
      },
      1 / Math.max(dt, 1e-4),
    );
    this.previousRateError = rateError;

    const torque = V3(
      rateError.x * g.rateKp.x + this.rateIntegral.x + derivative.x * 0.0022,
      rateError.y * g.rateKp.y + this.rateIntegral.y + derivative.y * 0.0015,
      rateError.z * g.rateKp.z + this.rateIntegral.z + derivative.z * 0.0022,
    );
    const limitedTorque = V3(
      clamp(torque.x, -g.maxTorque.x, g.maxTorque.x),
      clamp(torque.y, -g.maxTorque.y, g.maxTorque.y),
      clamp(torque.z, -g.maxTorque.z, g.maxTorque.z),
    );
    const saturated =
      Math.abs(torque.x) > g.maxTorque.x ||
      Math.abs(torque.y) > g.maxTorque.y ||
      Math.abs(torque.z) > g.maxTorque.z;

    const currentUp = quatRotate(state.orientation, UP);
    const projectedThrust = clamp(dot(force, currentUp), 0, 46);

    return {
      thrust: projectedThrust,
      torque: limitedTorque,
      desiredOrientation,
      desiredAngularVelocity: desiredRate,
      positionError,
      velocityError,
      saturated,
    };
  }
}

const clampTilt = (force: Vec3, maxTilt: number): Vec3 => {
  const up = force.y;
  if (up <= 0.1) return V3(0, 1, 0);
  const hz = horizontalLength(force);
  const maxHorizontal = up * Math.tan(maxTilt);
  if (hz <= maxHorizontal) return normalize(force);
  const scaleFactor = maxHorizontal / hz;
  return normalize(V3(force.x * scaleFactor, force.y, force.z * scaleFactor));
};

