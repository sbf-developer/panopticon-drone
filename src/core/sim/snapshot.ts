import type { Quat } from '../math/quat';
import type { Vec3 } from '../math/vec3';
import type { FlightCommand } from './controller';
import type { NavigationEstimate, TargetTrackStatus } from './estimator';
import type { MissionTelemetry } from './mission';
import type { PlannerStatus } from './planner';

export type EventSeverity = 'info' | 'success' | 'warn' | 'critical';

export interface SimEvent {
  id: number;
  time: number;
  severity: EventSeverity;
  source: string;
  message: string;
}

export interface PerceptionSnapshot {
  trackStatus: TargetTrackStatus;
  trackPosition: Vec3;
  trackVelocity: Vec3;
  confidence: number;
  updates: number;
  timeSinceUpdate: number;
  trackInitialized: boolean;
  covarianceTrace: number;
  detection: {
    visible: boolean;
    inFov: boolean;
    occluded: boolean;
    tooFar: boolean;
    range: number;
    bearing: number;
    elevation: number;
    screenX: number;
    screenY: number;
    laserValid: boolean;
    confidence: number;
  };
  gimbal: {
    position: Vec3;
    orientation: Quat;
    yaw: number;
    pitch: number;
    fovHorizontal: number;
    fovVertical: number;
    yawRate: number;
    pitchRate: number;
  };
  targetBearing: number;
  targetRange: number;
}

export interface DroneSnapshot {
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
  angularVelocity: Vec3;
  speed: number;
  altitude: number;
  agl: number;
  horizontalSpeed: number;
  verticalSpeed: number;
  roll: number;
  pitch: number;
  yaw: number;
  heading: number;
  throttle: number;
  batteryPercent: number;
  voltage: number;
  current: number;
  motors: [number, number, number, number];
  armed: boolean;
  onGround: boolean;
  crashed: boolean;
}

export interface TargetTruthSnapshot {
  position: Vec3;
  velocity: Vec3;
  speed: number;
  heading: number;
  odometer: number;
  routeProgress: number;
  lateralError: number;
}

export interface SensorSnapshot {
  satellites: number;
  hdop: number;
  gpsNis: number;
  baroNis: number;
  positionSigma: number;
  velocitySigma: number;
  accelRejected: boolean;
  magRejected: boolean;
  gpsAge: number;
}

export interface SimulationSnapshot {
  time: number;
  scenarioId: string;
  drone: DroneSnapshot;
  estimate: NavigationEstimate;
  targetTruth: TargetTruthSnapshot;
  perception: PerceptionSnapshot;
  mission: MissionTelemetry;
  plannedPath: Vec3[];
  command: FlightCommand;
  control: {
    thrust: number;
    torque: Vec3;
    saturated: boolean;
    desiredOrientation: Quat;
    desiredAngularVelocity: Vec3;
  };
  planner: {
    status: PlannerStatus;
    clearance: number;
    replans: number;
    candidateCount: number;
  };
  wind: {
    vector: Vec3;
    speed: number;
    meanSpeed: number;
    fromDegrees: number;
  };
  sensors: SensorSnapshot;
  collision: string | null;
  events: SimEvent[];
}
