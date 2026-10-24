import {
  type Vec3,
  V3,
  add,
  addScaled,
  clamp,
  horizontalLength,
  length,
  scale,
  sub,
  withY,
} from '../math/vec3';
import { type Quat, quatFromYaw, quatIntegrate, quatRotate, quatRotateInverse, quatToEuler } from '../math/quat';
import { invert, type Matrix } from '../math/matrix';

export interface DroneParameters {
  mass: number;
  armLength: number;
  inertia: Vec3;
  thrustCoefficient: number;
  maxMotorOmega: number;
  motorTimeConstant: number;
  rotorYawMoment: number;
  bodyDrag: number;
  angularDrag: Vec3;
  batteryCapacityWh: number;
  maxTiltRad: number;
}

export const DEFAULT_DRONE_PARAMETERS: DroneParameters = {
  mass: 2.35,
  armLength: 0.255,
  inertia: V3(0.032, 0.055, 0.041),
  thrustCoefficient: 1.15e-5,
  maxMotorOmega: 980,
  motorTimeConstant: 0.045,
  rotorYawMoment: 0.016,
  bodyDrag: 0.0185,
  angularDrag: V3(0.022, 0.03, 0.022),
  batteryCapacityWh: 111,
  maxTiltRad: (38 * Math.PI) / 180,
};

export interface DroneState {
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
  angularVelocity: Vec3;
  motorOmega: [number, number, number, number];
  motorTargetOmega: [number, number, number, number];
  motorThrust: [number, number, number, number];
  batteryWh: number;
  armed: boolean;
  onGround: boolean;
  crashed: boolean;
  groundImpactSpeed: number;
}

export interface ControlEffort {
  thrust: number;
  torque: Vec3;
}

const MOTOR_POSITIONS: ReadonlyArray<readonly [number, number, number]> = [
  [1, -1, 1], // front-right, CCW
  [1, 1, -1], // rear-right, CW
  [-1, 1, 1], // rear-left, CCW
  [-1, -1, -1], // front-left, CW
];

/** X-configuration quadrotor with per-motor thrust lag and a body-rate mixer. */
export class Quadrotor {
  readonly params: DroneParameters;
  state: DroneState;
  private readonly allocationInverse: Matrix;
  private readonly allocation: Matrix;

  constructor(
    params: DroneParameters = DEFAULT_DRONE_PARAMETERS,
    start?: { position: Vec3; yaw: number },
  ) {
    this.params = params;
    this.allocation = buildAllocationMatrix(params);
    this.allocationInverse = invert(this.allocation);
    this.state = createDroneState(
      start?.position ?? V3(0, 0.42, 0),
      start?.yaw ?? 0,
      params.batteryCapacityWh,
    );
  }

  reset(position: Vec3, yaw: number): void {
    this.state = createDroneState(position, yaw, this.params.batteryCapacityWh);
  }

  arm(): void {
    this.state.armed = true;
    this.state.crashed = false;
  }

  disarm(): void {
    this.state.armed = false;
    this.state.motorTargetOmega = [0, 0, 0, 0];
  }

  bodyUp(): Vec3 {
    return quatRotate(this.state.orientation, V3(0, 1, 0));
  }

  bodyForward(): Vec3 {
    return quatRotate(this.state.orientation, V3(0, 0, -1));
  }

  /**
   * Specific force at the IMU location, expressed in body axes. On the ground,
   * the landing gear reaction is what an accelerometer would actually feel.
   */
  specificForceBody(wind: Vec3): Vec3 {
    const s = this.state;
    const totalThrust = this.collectiveThrust();
    const thrustAccel = scale(this.bodyUp(), totalThrust / this.params.mass);
    const relativeAir = sub(s.velocity, wind);
    const airSpeed = length(relativeAir);
    const dragAccel = scale(
      relativeAir,
      (-this.params.bodyDrag * airSpeed) / this.params.mass,
    );
    const onGround = s.position.y <= 0.431 && totalThrust < this.params.mass * 9.80665 * 1.02;
    const properWorld = onGround
      ? V3(0, 9.80665, 0)
      : add(thrustAccel, dragAccel);
    return quatRotateInverse(s.orientation, properWorld);
  }


  collectiveThrust(): number {
    return (
      this.state.motorThrust[0] +
      this.state.motorThrust[1] +
      this.state.motorThrust[2] +
      this.state.motorThrust[3]
    );
  }

  /**
   * Allocate a collective thrust + body torque request to the four rotors and
   * latch it as the zero-order-hold target for the next motor dynamics step.
   */
  command(effort: ControlEffort): void {
    const p = this.params;
    const totalMax = 4 * p.thrustCoefficient * p.maxMotorOmega * p.maxMotorOmega;
    const collective = clamp(effort.thrust, 0, totalMax);
    const target = [collective, effort.torque.x, effort.torque.y, effort.torque.z];
    const motorThrust: number[] = [0, 0, 0, 0];
    const maxThrust = p.thrustCoefficient * p.maxMotorOmega * p.maxMotorOmega;
    for (let i = 0; i < 4; i += 1) {
      let sum = 0;
      for (let row = 0; row < 4; row += 1) {
        sum += this.allocationInverse[i]![row]! * target[row]!;
      }
      motorThrust[i] = clamp(sum, 0, maxThrust);
    }
    // If the allocation saturated, try to recover the requested collective
    // rather than silently losing altitude authority.
    const achieved = motorThrust.reduce((acc, value) => acc + value, 0);
    const deficit = collective - achieved;
    if (deficit > 0 && achieved > 1e-6) {
      const scaleUp = Math.min(1.22, collective / achieved);
      for (let i = 0; i < 4; i += 1) {
        motorThrust[i] = clamp(motorThrust[i]! * scaleUp, 0, maxThrust);
      }
    }
    for (let i = 0; i < 4; i += 1) {
      this.state.motorTargetOmega[i] = Math.sqrt(
        Math.max(0, motorThrust[i]!) / p.thrustCoefficient,
      );
    }
  }

  step(dt: number, wind: Vec3, groundHeight = 0): void {
    const p = this.params;
    const s = this.state;
    if (s.crashed) {
      this.integrateFreeFall(dt, wind, groundHeight);
      return;
    }

    const maxOmega =
      p.maxMotorOmega * (0.86 + 0.14 * clamp(s.batteryWh / p.batteryCapacityWh, 0, 1));
    const motorAlpha = 1 - Math.exp(-dt / p.motorTimeConstant);
    let totalThrust = 0;
    const thrusts: number[] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i += 1) {
      const targetOmega = clamp(s.motorTargetOmega[i]!, 0, maxOmega);
      const nextOmega = s.motorOmega[i]! + (targetOmega - s.motorOmega[i]!) * motorAlpha;
      s.motorOmega[i] = nextOmega;
      const thrust = p.thrustCoefficient * nextOmega * nextOmega;
      s.motorThrust[i] = thrust;
      thrusts[i] = thrust;
      totalThrust += thrust;
    }

    const torque = this.motorTorque(thrusts);
    const bodyUp = this.bodyUp();
    const thrustWorld = scale(bodyUp, totalThrust);
    const relativeAir = sub(s.velocity, wind);
    const airSpeed = length(relativeAir);
    const drag = scale(relativeAir, -p.bodyDrag * airSpeed);
    const gravity = V3(0, -9.80665, 0);
    const acceleration = add(
      add(scale(thrustWorld, 1 / p.mass), gravity),
      scale(drag, 1 / p.mass),
    );

    // Semi-implicit Euler at 240 Hz is stable for this rigid body and keeps
    // the controller's zero-order hold semantics intact.
    s.velocity = addScaled(s.velocity, acceleration, dt);
    s.position = addScaled(s.position, s.velocity, dt);

    const angularMomentum = V3(
      p.inertia.x * s.angularVelocity.x,
      p.inertia.y * s.angularVelocity.y,
      p.inertia.z * s.angularVelocity.z,
    );
    const gyro = V3(
      s.angularVelocity.y * angularMomentum.z - s.angularVelocity.z * angularMomentum.y,
      s.angularVelocity.z * angularMomentum.x - s.angularVelocity.x * angularMomentum.z,
      s.angularVelocity.x * angularMomentum.y - s.angularVelocity.y * angularMomentum.x,
    );
    const damping = V3(
      p.angularDrag.x * s.angularVelocity.x,
      p.angularDrag.y * s.angularVelocity.y,
      p.angularDrag.z * s.angularVelocity.z,
    );
    const angularAcceleration = V3(
      (torque.x - gyro.x - damping.x) / p.inertia.x,
      (torque.y - gyro.y - damping.y) / p.inertia.y,
      (torque.z - gyro.z - damping.z) / p.inertia.z,
    );
    s.angularVelocity = addScaled(s.angularVelocity, angularAcceleration, dt);
    s.orientation = quatIntegrate(s.orientation, s.angularVelocity, dt);

    // Simple electrical model: avionics + thrust-dependent propulsion power.
    const power = 82 + 6.4 * totalThrust + 0.45 * airSpeed * airSpeed;
    s.batteryWh = Math.max(0, s.batteryWh - (power * dt) / 3600);

    this.resolveGround(dt, groundHeight);
    s.onGround = s.position.y <= groundHeight + 0.43 && Math.abs(s.velocity.y) < 0.45;
  }

  telemetry(): {
    speed: number;
    horizontalSpeed: number;
    verticalSpeed: number;
    altitude: number;
    agl: number;
    roll: number;
    pitch: number;
    yaw: number;
    throttle: number;
    batteryPercent: number;
    voltage: number;
    current: number;
  } {
    const s = this.state;
    const p = this.params;
    const euler = quatToEuler(s.orientation);
    const totalThrust = this.collectiveThrust();
    const throttle = clamp(totalThrust / (4 * p.thrustCoefficient * p.maxMotorOmega ** 2), 0, 1);
    const power = 82 + 6.4 * totalThrust;
    const voltage = 22.2 * (0.84 + 0.16 * (s.batteryWh / p.batteryCapacityWh)) - power * 0.004;
    return {
      speed: length(s.velocity),
      horizontalSpeed: horizontalLength(s.velocity),
      verticalSpeed: s.velocity.y,
      altitude: s.position.y,
      agl: Math.max(0, s.position.y - 0.42),
      roll: euler.roll,
      pitch: euler.pitch,
      yaw: euler.yaw,
      throttle,
      batteryPercent: (s.batteryWh / p.batteryCapacityWh) * 100,
      voltage,
      current: power / Math.max(10, voltage),
    };
  }

  private integrateFreeFall(dt: number, wind: Vec3, groundHeight: number): void {
    const s = this.state;
    const airSpeed = length(sub(s.velocity, wind));
    const drag = scale(sub(s.velocity, wind), -this.params.bodyDrag * airSpeed * 0.6);
    s.velocity = addScaled(s.velocity, V3(0, -9.80665, 0), dt);
    s.velocity = addScaled(s.velocity, drag, dt);
    s.position = addScaled(s.position, s.velocity, dt);
    s.angularVelocity = scale(s.angularVelocity, Math.exp(-1.6 * dt));
    s.orientation = quatIntegrate(s.orientation, s.angularVelocity, dt);
    this.resolveGround(dt, groundHeight);
  }

  private resolveGround(dt: number, groundHeight: number): void {
    const s = this.state;
    const minY = groundHeight + 0.42;
    if (s.position.y > minY) return;
    const impact = -s.velocity.y;
    if (impact > 4.5 && s.armed) {
      s.crashed = true;
      s.groundImpactSpeed = impact;
    }
    s.position = withY(s.position, minY);
    if (s.velocity.y < 0) s.velocity = V3(s.velocity.x, 0, s.velocity.z);
    // Skid friction when sitting on the ground with insufficient lift.
    const grounded = this.collectiveThrust() < this.params.mass * 9.80665 * 0.9;
    if (grounded) {
      const friction = Math.exp(-6 * dt);
      s.velocity = V3(s.velocity.x * friction, s.velocity.y, s.velocity.z * friction);
    }
  }

  private motorTorque(thrusts: readonly number[]): Vec3 {
    const p = this.params;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    for (let i = 0; i < 4; i += 1) {
      const [armX, armZ, spin] = MOTOR_POSITIONS[i]!;
      const thrust = thrusts[i]!;
      tx += -armZ * p.armLength * thrust;
      tz += armX * p.armLength * thrust;
      ty += spin * p.rotorYawMoment * thrust;
    }
    return V3(tx, ty, tz);
  }
}

const buildAllocationMatrix = (p: DroneParameters): Matrix => {
  const matrix = Array.from({ length: 4 }, () => Array<number>(4).fill(0));
  for (let i = 0; i < 4; i += 1) {
    const [armX, armZ, spin] = MOTOR_POSITIONS[i]!;
    matrix[0]![i] = 1;
    matrix[1]![i] = -armZ * p.armLength;
    matrix[2]![i] = spin * p.rotorYawMoment;
    matrix[3]![i] = armX * p.armLength;
  }
  return matrix;
};

const createDroneState = (position: Vec3, yaw: number, batteryWh: number): DroneState => ({
  position: withY(position, Math.max(0.42, position.y)),
  velocity: V3(),
  orientation: quatFromYaw(yaw),
  angularVelocity: V3(),
  motorOmega: [0, 0, 0, 0],
  motorTargetOmega: [0, 0, 0, 0],
  motorThrust: [0, 0, 0, 0],
  batteryWh,
  armed: false,
  onGround: true,
  crashed: false,
  groundImpactSpeed: 0,
});

/** Hover motor speed is useful for tests and controller feed-forward. */
export const hoverOmega = (p: DroneParameters = DEFAULT_DRONE_PARAMETERS): number =>
  Math.sqrt((p.mass * 9.80665) / (4 * p.thrustCoefficient));

export const hoverThrust = (p: DroneParameters = DEFAULT_DRONE_PARAMETERS): number =>
  (p.mass * 9.80665) / 4;

export const bodyAxes = (
  orientation: Quat,
): { right: Vec3; up: Vec3; back: Vec3 } => ({
  right: quatRotate(orientation, V3(1, 0, 0)),
  up: quatRotate(orientation, V3(0, 1, 0)),
  back: quatRotate(orientation, V3(0, 0, 1)),
});
