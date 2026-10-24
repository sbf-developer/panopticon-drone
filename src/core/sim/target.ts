import {
  type Vec3,
  V3,
  clamp,
  direction2D,
  wrapPi,
} from '../math/vec3';
import { Rng } from '../math/random';
import { RoutePath } from '../world/path';
import type { TargetScenarioSpec } from '../world/types';

export interface TargetState {
  position: Vec3;
  heading: number;
  speed: number;
  acceleration: number;
  distanceAlongRoute: number;
  odometer: number;
  lateralError: number;
  yawRate: number;
}

/** Kinematic bicycle-like ground subject following a smooth A-to-B route. */
export class GroundTarget {
  readonly spec: TargetScenarioSpec;
  readonly route: RoutePath;
  state: TargetState;
  private readonly rng: Rng;
  private elapsed = 0;
  private evasivePhase = 0;

  constructor(spec: TargetScenarioSpec, route: RoutePath, seed: number) {
    this.spec = spec;
    this.route = route;
    this.rng = new Rng(seed ^ 0x51ed270b);
    this.state = this.createState();
  }

  reset(): void {
    this.elapsed = 0;
    this.evasivePhase = this.rng.range(0, Math.PI * 2);
    this.state = this.createState();
  }

  get truthPosition(): Vec3 {
    return this.state.position;
  }

  get headingVector(): Vec3 {
    return direction2D(this.state.heading);
  }

  get velocity(): Vec3 {
    return {
      x: -Math.sin(this.state.heading) * this.state.speed,
      y: 0,
      z: -Math.cos(this.state.heading) * this.state.speed,
    };
  }

  step(dt: number): void {
    const s = this.state;
    this.elapsed += dt;
    this.evasivePhase += dt * 0.62;

    if (this.elapsed < this.spec.departureDelay) {
      s.speed = Math.max(0, s.speed - 2.4 * dt);
      s.acceleration = 0;
      return;
    }

    const lookahead = clamp(5.5 + s.speed * 0.62, 7, 16);
    const aim = this.route.pointAt(s.distanceAlongRoute + lookahead);
    const dx = aim.x - s.position.x;
    const dz = aim.z - s.position.z;
    const desiredHeading = Math.atan2(-dx, -dz);
    const headingError = wrapPi(desiredHeading - s.heading);

    const maxYawRate = Math.min(0.92, 4.4 / Math.max(4, s.speed));
    const desiredYawRate = clamp(headingError * 2.1, -maxYawRate, maxYawRate);
    const yawAlpha = 1 - Math.exp(-dt * 2.8);
    s.yawRate += (desiredYawRate - s.yawRate) * yawAlpha;
    s.yawRate = clamp(s.yawRate, -maxYawRate, maxYawRate);
    s.heading = wrapPi(s.heading + s.yawRate * dt);

    let desiredSpeed = this.spec.cruiseSpeed;
    if (this.spec.evasive) {
      const pulse = Math.sin(this.evasivePhase) * 0.5 + Math.sin(this.evasivePhase * 0.37) * 0.5;
      desiredSpeed += pulse * this.spec.speedVariance * 1.5;
    } else {
      desiredSpeed += Math.sin(this.elapsed * 0.19 + 0.7) * this.spec.speedVariance;
    }
    desiredSpeed *= 1 - clamp(Math.abs(headingError) * 0.38, 0, 0.4);
    desiredSpeed = clamp(desiredSpeed, 2.2, this.spec.cruiseSpeed + this.spec.speedVariance * 2.2);

    const acceleration = clamp(
      (desiredSpeed - s.speed) * 0.65,
      -this.spec.maxAcceleration * 1.25,
      this.spec.maxAcceleration,
    );
    s.acceleration += (acceleration - s.acceleration) * (1 - Math.exp(-dt * 2.2));
    s.speed = Math.max(0, s.speed + s.acceleration * dt);

    const forward = direction2D(s.heading);
    s.position = {
      x: s.position.x + forward.x * s.speed * dt,
      y: 0,
      z: s.position.z + forward.z * s.speed * dt,
    };
    s.odometer += s.speed * dt;

    const nearest = this.route.closest(s.position.x, s.position.z);
    const previousDistance = s.distanceAlongRoute;
    if (nearest.distance < 14) {
      // Route progress must only advance locally; a global closest-point lookup
      // can jump at self-intersections.
      const delta = wrapRouteDelta(nearest.s - previousDistance, this.route.length);
      if (Math.abs(delta) < 20) s.distanceAlongRoute = wrapDistance(previousDistance + delta, this.route.length);
    } else {
      s.distanceAlongRoute = wrapDistance(previousDistance + s.speed * dt, this.route.length);
    }
    s.lateralError = this.route.lateralOffset(s.position.x, s.position.z, s.distanceAlongRoute);
  }

  private createState(): TargetState {
    const routePoint = this.route.pointAt(this.spec.initialRouteDistance);
    const tangent = this.route.tangentAt(this.spec.initialRouteDistance);
    return {
      position: V3(routePoint.x, 0, routePoint.z),
      heading: Math.atan2(-tangent.x, -tangent.z),
      speed: this.spec.departureDelay > 0 ? 0 : this.spec.cruiseSpeed * 0.72,
      acceleration: 0,
      distanceAlongRoute: this.spec.initialRouteDistance,
      odometer: 0,
      lateralError: 0,
      yawRate: 0,
    };
  }
}

const wrapDistance = (distance: number, length: number): number =>
  ((distance % length) + length) % length;

const wrapRouteDelta = (delta: number, length: number): number => {
  let d = delta;
  if (d > length / 2) d -= length;
  if (d < -length / 2) d += length;
  return d;
};
