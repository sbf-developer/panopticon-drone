import {
  type Vec3,
  V3,
  add,
  clamp,
  distance,
  horizontal,
  horizontalLength,
  normalize,
  scale,
  sub,
} from '../math/vec3';
import type { NavigationEstimate, TargetTrack } from './estimator';
import { LocalPlanner, type PlannerStatus } from './planner';
import type { FlightCommand } from './controller';
import { World } from '../world/environment';
import type { ScenarioDefinition } from '../world/types';

export type MissionPhase = 'TAKEOFF' | 'ACQUIRE' | 'TRACK' | 'LOST' | 'RTH' | 'LAND' | 'COMPLETE' | 'FAILED';
export type FollowBehavior = 'PURSUIT' | 'OVERWATCH';

export interface MissionTelemetry {
  phase: MissionPhase;
  phaseLabel: string;
  phaseTime: number;
  behavior: FollowBehavior;
  standoff: number;
  standoffError: number;
  targetRange: number;
  targetBearing: number;
  viewpoint: Vec3 | null;
  aimPoint: Vec3;
  plannerStatus: PlannerStatus;
  plannerClearance: number;
  candidateCount: number;
  replans: number;
  lostTime: number;
  failsafe: string | null;
  targetVisible: boolean;
}

export interface AutonomyOutput {
  command: FlightCommand;
  aimPoint: Vec3;
  telemetry: MissionTelemetry;
  phaseChanged: boolean;
}

const PHASE_LABEL: Record<MissionPhase, string> = {
  TAKEOFF: 'Vertical departure',
  ACQUIRE: 'Visual acquisition',
  TRACK: 'Target pursuit',
  LOST: 'Contingency search',
  RTH: 'Return to launch',
  LAND: 'Terminal descent',
  COMPLETE: 'Mission complete',
  FAILED: 'Mission failed',
};

const VIEW_OFFSETS_DEG = [0, -28, 28, -56, 56, -88, 88, -122, 122, 180] as const;

/**
 * Mission/behaviour layer. It consumes only the navigation estimate, the
 * target track, and the static world model — never target or drone truth.
 */
export class AutonomySystem {
  readonly scenario: ScenarioDefinition;
  private readonly world: World;
  private readonly planner = new LocalPlanner();
  behavior: FollowBehavior = 'PURSUIT';
  standoff: number;
  cruiseAltitude: number;
  phase: MissionPhase = 'TAKEOFF';
  phaseStarted = 0;
  now = 0;
  lastKnownTarget: Vec3 | null = null;
  private previousViewpoint: Vec3 | null = null;
  private viewpointAngleDeg = 0;
  private phaseChanged = false;
  private command: FlightCommand;
  private aimPoint: Vec3;
  private failsafe: string | null = null;
  private lostTime = 0;
  private searchAngle = 0;
  private lastStandoffError = 0;
  private lastTargetRange = 0;
  private lastTargetBearing = 0;
  private lastTargetVisible = false;

  constructor(scenario: ScenarioDefinition, world: World) {
    this.scenario = scenario;
    this.world = world;
    this.standoff = scenario.drone.standoff;
    this.cruiseAltitude = scenario.drone.cruiseAltitude;
    const home = V3(scenario.drone.home.x, this.cruiseAltitude, scenario.drone.home.z);
    this.command = {
      position: home,
      velocity: V3(),
      acceleration: V3(),
      yaw: scenario.drone.initialYaw,
      yawRate: 0,
    };
    this.aimPoint = this.cuePoint();
  }

  reset(): void {
    this.planner.reset();
    this.phase = 'TAKEOFF';
    this.phaseStarted = 0;
    this.now = 0;
    this.lastKnownTarget = null;
    this.previousViewpoint = null;
    this.viewpointAngleDeg = 0;
    this.phaseChanged = true;
    this.failsafe = null;
    this.lostTime = 0;
    this.searchAngle = 0;
    this.lastStandoffError = 0;
    this.lastTargetRange = 0;
    this.lastTargetBearing = 0;
    this.lastTargetVisible = false;
    const home = V3(this.scenario.drone.home.x, this.cruiseAltitude, this.scenario.drone.home.z);
    this.command = {
      position: home,
      velocity: V3(),
      acceleration: V3(),
      yaw: this.scenario.drone.initialYaw,
      yawRate: 0,
    };
    this.aimPoint = this.cuePoint();
  }

  setBehavior(behavior: FollowBehavior): void {
    this.behavior = behavior;
  }

  setStandoff(distanceMeters: number): void {
    this.standoff = clamp(distanceMeters, 9, 55);
  }

  update(
    now: number,
    dt: number,
    nav: NavigationEstimate,
    target: TargetTrack,
    batteryPercent: number,
    onGround: boolean,
    crashed: boolean,
  ): AutonomyOutput {
    this.now = now;
    this.phaseChanged = false;
    const phaseBefore = this.phase;
    const cue = this.cuePoint();
    const phaseTime = now - this.phaseStarted;

    if (crashed) {
      this.transition('FAILED', now);
      this.command = {
        position: nav.position,
        velocity: V3(),
        acceleration: V3(),
        yaw: this.command.yaw,
        yawRate: 0,
      };
      this.aimPoint = cue;
      return this.output();
    }

    const trackingFresh = target.initialized && (target.status === 'TRACKING' || target.status === 'ACQUIRING' || target.status === 'COASTING');
    if (target.initialized && target.status !== 'LOST') {
      this.lastKnownTarget = target.position;
    }
    this.lastTargetVisible = target.status !== 'LOST' && target.initialized && target.timeSinceUpdate < 0.42;

    if (batteryPercent < 9 && this.phase !== 'LAND' && this.phase !== 'COMPLETE') {
      this.failsafe = 'Battery critical — forced descent';
      this.transition('LAND', now);
    } else if (batteryPercent < 21 && this.phase === 'TRACK') {
      this.failsafe = 'Battery reserve — returning to launch';
      this.transition('RTH', now);
    }

    if (!this.world.inBounds(nav.position) && this.phase !== 'RTH' && this.phase !== 'LAND') {
      this.failsafe = 'Geofence breach — returning to launch';
      this.transition('RTH', now);
    }

    switch (this.phase) {
      case 'TAKEOFF':
        this.aimPoint = cue;
        this.command = this.holdCommand(
          V3(this.scenario.drone.home.x, this.cruiseAltitude, this.scenario.drone.home.z),
          this.scenario.drone.initialYaw,
        );
        if (
          nav.position.y > this.cruiseAltitude - 2.4 &&
          Math.abs(nav.velocity.y) < 1.1 &&
          horizontalLength(sub(nav.position, V3(this.scenario.drone.home.x, nav.position.y, this.scenario.drone.home.z))) < 5 &&
          phaseTime > 2
        ) {
          this.transition('ACQUIRE', now);
        }
        break;

      case 'ACQUIRE':
        this.aimPoint = trackingFresh ? this.trackedAim(target) : cue;
        this.command = this.holdCommand(
          V3(this.scenario.drone.home.x, this.cruiseAltitude, this.scenario.drone.home.z),
          this.lookYaw(nav.position, trackingFresh ? target.position : this.cuePoint()),
        );
        if (trackingFresh) {
          this.lastKnownTarget = target.position;
          this.transition('TRACK', now);
        } else if (phaseTime > 12) {
          this.lastKnownTarget = this.cuePoint();
          this.lostTime = 0;
          this.transition('LOST', now);
        }
        break;

      case 'TRACK': {
        if (!trackingFresh) {
          this.lostTime = 0;
          this.searchAngle = this.lookYaw(nav.position, this.lastKnownTarget ?? cue);
          this.transition('LOST', now);
          break;
        }
        if (target.timeSinceUpdate > 0.95) {
          this.lostTime = 0;
          this.searchAngle = this.lookYaw(nav.position, target.position);
          this.transition('LOST', now);
          break;
        }
        const targetPoint = add(target.position, V3(0, 1.1, 0));
        const viewpoint = this.selectViewpoint(nav.position, target, targetPoint);
        const plan = this.planner.plan(
          {
            position: nav.position,
            velocity: nav.velocity,
            goal: viewpoint,
            goalVelocity: target.velocity,
            targetPoint,
            maxSpeed: 23,
            minAltitude: 3.2,
          },
          this.world,
        );
        this.command = {
          position: plan.waypoint,
          velocity: plan.velocity,
          acceleration: V3(),
          yaw: this.lookYaw(nav.position, target.position),
          yawRate: 0,
        };
        this.aimPoint = add(this.trackedAim(target), V3(0, 0.4, 0));
        this.lastStandoffError = horizontalLength(sub(nav.position, target.position)) - this.standoff;
        this.lastTargetRange = distance(nav.position, target.position);
        this.lastTargetBearing = this.bearingTo(nav.position, target.position);
        break;
      }

      case 'LOST': {
        this.lostTime += dt;
        this.searchAngle += dt * 0.55;
        const anchor = this.lastKnownTarget ?? this.cuePoint();
        const radius = 11 + Math.min(9, this.lostTime * 0.65);
        const goal = V3(
          anchor.x + Math.sin(this.searchAngle) * radius,
          this.cruiseAltitude,
          anchor.z + Math.cos(this.searchAngle) * radius,
        );
        const plan = this.planner.plan(
          {
            position: nav.position,
            velocity: nav.velocity,
            goal,
            targetPoint: null,
            maxSpeed: 13,
            minAltitude: 3.2,
          },
          this.world,
        );
        this.command = {
          position: plan.waypoint,
          velocity: plan.velocity,
          acceleration: V3(),
          yaw: this.lookYaw(nav.position, anchor),
          yawRate: 0,
        };
        this.command.yawRate = 0.22;
        this.aimPoint = add(anchor, V3(0, 1.2, 0));
        if (trackingFresh) {
          this.transition('TRACK', now);
        } else if (this.lostTime > 22) {
          this.failsafe = 'Target lost — returning to launch';
          this.transition('RTH', now);
        }
        break;
      }

      case 'RTH': {
        const home = V3(this.scenario.drone.home.x, this.cruiseAltitude, this.scenario.drone.home.z);
        const plan = this.planner.plan(
          {
            position: nav.position,
            velocity: nav.velocity,
            goal: home,
            targetPoint: null,
            maxSpeed: 18,
            minAltitude: 3.2,
          },
          this.world,
        );
        this.command = {
          position: plan.waypoint,
          velocity: plan.velocity,
          acceleration: V3(),
          yaw: this.lookYaw(nav.position, home),
          yawRate: 0,
        };
        this.aimPoint = add(this.lastKnownTarget ?? this.cuePoint(), V3(0, 1.1, 0));
        if (distance(nav.position, home) < 6.5) this.transition('LAND', now);
        if (batteryPercent < 9) this.transition('LAND', now);
        break;
      }

      case 'LAND': {
        const landing = V3(this.scenario.drone.home.x, 0.7, this.scenario.drone.home.z);
        this.command = this.holdCommand(landing, this.command.yaw);
        this.aimPoint = this.cuePoint();
        if (onGround || nav.position.y < 1.1) {
          this.transition('COMPLETE', now);
        }
        break;
      }

      case 'COMPLETE':
      case 'FAILED': {
        this.command = {
          position: nav.position,
          velocity: V3(),
          acceleration: V3(),
          yaw: this.command.yaw,
          yawRate: 0,
        };
        break;
      }
    }

    if (this.command.position.y < 0.65 && this.phase !== 'LAND') {
      this.command = { ...this.command, position: { ...this.command.position, y: 0.7 } };
    }
    if (phaseBefore !== this.phase) this.phaseChanged = true;
    return this.output();
  }

  private output(): AutonomyOutput {
    return {
      command: this.command,
      aimPoint: this.aimPoint,
      telemetry: {
        phase: this.phase,
        phaseLabel: PHASE_LABEL[this.phase],
        phaseTime: this.now - this.phaseStarted,
        behavior: this.behavior,
        standoff: this.standoff,
        standoffError: this.lastStandoffError,
        targetRange: this.lastTargetRange,
        targetBearing: this.lastTargetBearing,
        viewpoint: this.previousViewpoint,
        aimPoint: this.aimPoint,
        plannerStatus: this.planner.status,
        plannerClearance: this.planner.clearance,
        candidateCount: this.planner.candidateCount,
        replans: this.planner.replans,
        lostTime: this.phase === 'LOST' ? this.lostTime : 0,
        failsafe: this.failsafe,
        targetVisible: this.lastTargetVisible,
      },
      phaseChanged: this.phaseChanged,
    };
  }

  private selectViewpoint(dronePosition: Vec3, target: TargetTrack, targetPoint: Vec3): Vec3 {
    const speed = horizontalLength(target.velocity);
    const behind =
      speed > 1.3
        ? normalize(scale(horizontal(target.velocity), -1))
        : normalize(horizontal(sub(dronePosition, target.position)));
    const overwatch = this.behavior === 'OVERWATCH';
    const baseAngle = overwatch ? this.now * 0.17 : Math.atan2(behind.z, behind.x);
    const offsets = overwatch ? ([0, 18, -18, 36, -36, 60, -60] as const) : VIEW_OFFSETS_DEG;
    let best: { point: Vec3; score: number; angle: number } | null = null;
    for (const offsetDeg of offsets) {
      if (!overwatch && Math.abs(offsetDeg) > 90) continue;
      const angle = baseAngle + (offsetDeg * Math.PI) / 180;
      const point = V3(
        target.position.x + Math.cos(angle) * this.standoff,
        this.cruiseAltitude,
        target.position.z + Math.sin(angle) * this.standoff,
      );
      if (!this.world.inBounds(point)) continue;
      const clearance = this.world.clearance(point)?.clearance ?? 50;
      if (clearance < 4) continue;
      let score = -Math.min(clearance, 14) * 3;
      if (this.world.segmentBlocked(point, targetPoint, 0.15)) score += 80;
      score += Math.abs(offsetDeg) * (overwatch ? 0.05 : 0.22);
      score += distance(point, dronePosition) * 0.055;
      if (this.previousViewpoint) score += distance(point, this.previousViewpoint) * (overwatch ? 0.015 : 0.22);
      if (!best || score < best.score) best = { point, score, angle: offsetDeg };
    }
    const chosen = best ?? {
      point: V3(target.position.x, this.cruiseAltitude, target.position.z - this.standoff),
      score: 0,
      angle: 0,
    };
    if (!this.previousViewpoint || distance(chosen.point, this.previousViewpoint) > 2.5) {
      this.viewpointAngleDeg = chosen.angle;
    }
    this.previousViewpoint = chosen.point;
    return chosen.point;
  }

  private trackedAim(target: TargetTrack): Vec3 {
    const lead = scale(target.velocity, 0.18);
    return add(add(target.position, lead), V3(0, 1.1, 0));
  }

  private cuePoint(): Vec3 {
    return V3(this.scenario.drone.searchCue.x, 1.2, this.scenario.drone.searchCue.z);
  }

  private holdCommand(position: Vec3, yaw: number): FlightCommand {
    return { position, velocity: V3(), acceleration: V3(), yaw, yawRate: 0 };
  }

  private lookYaw(from: Vec3, to: Vec3): number {
    return Math.atan2(-(to.x - from.x), -(to.z - from.z));
  }

  private bearingTo(from: Vec3, to: Vec3): number {
    return Math.atan2(to.x - from.x, -(to.z - from.z));
  }

  private transition(phase: MissionPhase, now: number): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.phaseStarted = now;
    this.phaseChanged = true;
    this.lostTime = 0;
  }

  get viewpointAngle(): number {
    return this.viewpointAngleDeg;
  }

  get lastPhase(): MissionPhase {
    return this.phase;
  }


  get currentCommand(): FlightCommand {
    return this.command;
  }

  get plannedPath(): Vec3[] {
    return this.planner.plannedPath;
  }
}
