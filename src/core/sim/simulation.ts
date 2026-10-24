import {
  V3,
  compassDegrees,
  distance,
  scale,
  sub,
} from '../math/vec3';
import { quatToEuler } from '../math/quat';
import { getScenario } from '../world/scenarios';
import { World } from '../world/environment';
import { RoutePath } from '../world/path';
import type { ScenarioDefinition } from '../world/types';
import { Quadrotor } from './drone';
import { FlightController, type ControlOutput } from './controller';
import {
  AttitudeEstimator,
  NavigationFilter,
  type NavigationEstimate,
  TargetTracker,
  type TargetTrack,
  type TargetTrackStatus,
} from './estimator';
import {
  Gimbal,
  SensorModels,
  TargetDetector,
  type BaroSample,
  type GpsSample,
  type GimbalPose,
  type MagSample,
  type TargetDetection,
} from './sensors';
import { GroundTarget } from './target';
import { AutonomySystem, type AutonomyOutput, type MissionPhase } from './mission';
import type { EventSeverity, SimEvent, SimulationSnapshot } from './snapshot';

export const SIM_DT = 1 / 240;

const PHASE_MESSAGES: Record<MissionPhase, { severity: EventSeverity; message: string }> = {
  TAKEOFF: { severity: 'info', message: 'Autonomy armed — vertical departure to cruise altitude.' },
  ACQUIRE: { severity: 'info', message: 'Altitude gate captured — camera slewing to visual search cue.' },
  TRACK: { severity: 'success', message: 'Visual lock established — pursuit controller engaged.' },
  LOST: { severity: 'warn', message: 'Target track stale — entering expanding contingency search.' },
  RTH: { severity: 'warn', message: 'Return-to-launch failsafe active.' },
  LAND: { severity: 'info', message: 'Terminal descent — landing sequence started.' },
  COMPLETE: { severity: 'success', message: 'Mission complete — airframe disarmed.' },
  FAILED: { severity: 'critical', message: 'Flight failure — autonomy disengaged.' },
};

const emptyDetection = (): TargetDetection => ({
  time: 0,
  visible: false,
  inFov: false,
  occluded: false,
  tooFar: false,
  range: 0,
  bearing: 0,
  elevation: 0,
  position: V3(),
  variance: V3(10, 10, 10),
  screenX: 0.5,
  screenY: 0.5,
  confidence: 0,
  laserValid: false,
});

/**
 * Deterministic, renderer-independent simulation. Everything runs on a fixed
 * 240 Hz step; sensors and autonomy modules are scheduled inside that tick.
 * Rendering only reads snapshots, so the dynamics can be tested headlessly.
 */
export class Simulation {
  readonly scenario: ScenarioDefinition;
  readonly world: World;
  readonly route: RoutePath;
  readonly drone: Quadrotor;
  readonly target: GroundTarget;
  readonly controller: FlightController;
  readonly attitude: AttitudeEstimator;
  readonly navigation: NavigationFilter;
  readonly targetTracker: TargetTracker;
  readonly gimbal: Gimbal;
  readonly detector: TargetDetector;
  readonly sensors: SensorModels;
  readonly autonomy: AutonomySystem;

  time = 0;
  stepIndex = 0;
  collisionObstacle: string | null = null;

  private track: TargetTrack;
  private navEstimate: NavigationEstimate;
  private autonomyOutput: AutonomyOutput;
  private controlOutput: ControlOutput;
  private gimbalPose: GimbalPose;
  private detection: TargetDetection = emptyDetection();
  private latestMag: MagSample | null = null;
  private latestGps: GpsSample | null = null;
  private latestBaro: BaroSample | null = null;
  private events: SimEvent[] = [];
  private eventId = 1;
  private lastPhase: MissionPhase = 'TAKEOFF';
  private lastTrackStatus: TargetTrackStatus = 'SEARCHING';
  private lockLogged = false;
  private coastLogged = false;
  private lostLogged = false;
  private completeLogged = false;
  private motionLogged = false;
  private standoffLogged = false;
  private plannerIssueLogged = false;
  private lastSpecificForce = V3(0, 9.80665, 0);
  private previousNavVelocity = V3();
  private navAcceleration = V3();
  private accumulators = {
    detection: 0,
    gps: 0,
    baro: 0,
    mag: 0,
    nav: 0,
    control: 0,
    autonomy: 0,
    wind: 0,
    collision: 0,
    tracker: 0,
  };

  constructor(scenarioId: string) {
    this.scenario = getScenario(scenarioId);
    this.world = new World(this.scenario);
    this.route = new RoutePath(this.scenario.route, 1.5);
    this.target = new GroundTarget(this.scenario.target, this.route, this.scenario.seed);
    this.drone = new Quadrotor(undefined, {
      position: V3(this.scenario.drone.home.x, 0.42, this.scenario.drone.home.z),
      yaw: this.scenario.drone.initialYaw,
    });
    this.controller = new FlightController();
    this.attitude = new AttitudeEstimator();
    this.navigation = new NavigationFilter(this.drone.state.position);
    this.targetTracker = new TargetTracker();
    this.gimbal = new Gimbal(this.scenario.drone.initialYaw);
    this.detector = new TargetDetector(this.scenario.seed);
    this.sensors = new SensorModels(this.scenario.seed);
    this.autonomy = new AutonomySystem(this.scenario, this.world);
    this.track = this.targetTracker.track(0);
    this.navEstimate = this.navigation.estimate(this.attitude.orientation, V3());
    this.gimbalPose = this.gimbal.update(
      this.drone.state.position,
      this.drone.state.orientation,
      V3(this.scenario.drone.searchCue.x, 1.2, this.scenario.drone.searchCue.z),
      0,
    );
    this.autonomyOutput = this.autonomy.update(
      0,
      SIM_DT,
      this.navEstimate,
      this.track,
      100,
      true,
      false,
    );
    this.controlOutput = this.controller.update(
      this.navEstimate,
      this.autonomyOutput.command,
      1 / 100,
      this.drone.params.mass,
    );
    this.reset();
  }

  reset(): void {
    this.time = 0;
    this.stepIndex = 0;
    this.collisionObstacle = null;
    this.world.reset();
    this.target.reset();
    this.drone.reset(
      V3(this.scenario.drone.home.x, 0.42, this.scenario.drone.home.z),
      this.scenario.drone.initialYaw,
    );
    this.drone.arm();
    this.controller.reset();
    this.controller.enabled = true;
    this.attitude.reset();
    this.navigation.reset(this.drone.state.position);
    this.targetTracker.reset();
    this.gimbal.reset(this.scenario.drone.initialYaw);
    this.sensors.reset();
    this.autonomy.reset();
    this.events = [];
    this.eventId = 1;
    this.lastPhase = 'TAKEOFF';
    this.lastTrackStatus = 'SEARCHING';
    this.lockLogged = false;
    this.coastLogged = false;
    this.lostLogged = false;
    this.completeLogged = false;
    this.motionLogged = false;
    this.standoffLogged = false;
    this.plannerIssueLogged = false;
    this.track = this.targetTracker.track(0);
    this.latestMag = this.sensors.magnetometer(0, this.drone.state.orientation);
    this.detection = emptyDetection();
    this.latestGps = this.sensors.gps(0, this.drone.state.position, 0.125);
    this.navigation.updateGps(this.latestGps.position, this.latestGps.variance, 0);
    this.latestBaro = this.sensors.barometer(0, this.drone.state.position.y);
    this.lastSpecificForce = this.drone.specificForceBody(V3());
    this.navEstimate = this.navigation.estimate(this.attitude.orientation, V3());
    this.gimbal.lookAtImmediate(
      this.drone.state.position,
      this.drone.state.orientation,
      V3(this.scenario.drone.searchCue.x, 1.2, this.scenario.drone.searchCue.z),
    );
    this.gimbalPose = this.gimbal.update(
      this.drone.state.position,
      this.drone.state.orientation,
      V3(this.scenario.drone.searchCue.x, 1.2, this.scenario.drone.searchCue.z),
      0,
    );
    this.autonomyOutput = this.autonomy.update(
      0,
      SIM_DT,
      this.navEstimate,
      this.track,
      100,
      true,
      false,
    );
    this.controlOutput = this.controller.update(
      this.navEstimate,
      this.autonomyOutput.command,
      1 / 100,
      this.drone.params.mass,
    );
    this.previousNavVelocity = this.navEstimate.velocity;
    this.navAcceleration = V3();
    this.drone.command({ thrust: 0, torque: V3() });
    this.accumulators = {
      detection: 0,
      gps: 0,
      baro: 0,
      mag: 0,
      nav: 0,
      control: 0,
      autonomy: 0,
      wind: 0,
      collision: 0,
      tracker: 0,
    };
    this.log('info', 'SIM', `Scenario loaded: ${this.scenario.name} (${this.scenario.code}).`);
    this.log('info', 'AUTONOMY', PHASE_MESSAGES.TAKEOFF.message);
  }

  step(): void {
    const dt = SIM_DT;
    const now = this.time;
    const windEnabled = !this.drone.state.crashed;

    this.accumulators.wind += dt;
    if (this.accumulators.wind >= 1 / 60) {
      this.world.wind.step(this.accumulators.wind);
      this.accumulators.wind = 0;
    }
    if (windEnabled) this.target.step(dt);
    const wind = this.world.wind.sample();

    this.gimbalPose = this.gimbal.update(
      this.drone.state.position,
      this.drone.state.orientation,
      this.autonomyOutput.aimPoint,
      dt,
    );

    this.accumulators.detection += dt;
    if (this.accumulators.detection >= 1 / 30) {
      const targetPoint = V3(
        this.target.state.position.x,
        1.1,
        this.target.state.position.z,
      );
      this.detection = this.detector.detect(targetPoint, this.gimbalPose, this.world, now);
      if (this.detection.visible && this.detection.laserValid) {
        this.targetTracker.update(this.detection.position, this.detection.variance, now);
      }
      this.accumulators.detection = 0;
    }

    this.accumulators.tracker += dt;
    if (this.accumulators.tracker >= 1 / 120) {
      this.targetTracker.predict(this.accumulators.tracker, now);
      this.accumulators.tracker = 0;
    }
    this.track = this.targetTracker.track(now);

    this.lastSpecificForce = this.drone.specificForceBody(wind);
    const imu = this.sensors.imu(now, this.lastSpecificForce, this.drone.state.angularVelocity, dt);
    this.attitude.update(
      imu.gyro,
      imu.accel,
      this.latestMag?.field ?? null,
      dt,
      this.navAcceleration,
    );

    this.accumulators.mag += dt;
    if (this.accumulators.mag >= 1 / 50) {
      this.latestMag = this.sensors.magnetometer(now, this.drone.state.orientation);
      this.accumulators.mag = 0;
    }

    this.accumulators.nav += dt;
    if (this.accumulators.nav >= 1 / 100) {
      this.navigation.predict(this.lastSpecificForce, this.attitude.orientation, this.accumulators.nav);
      this.accumulators.nav = 0;
    }

    this.accumulators.gps += dt;
    if (this.accumulators.gps >= 1 / 8) {
      this.latestGps = this.sensors.gps(now, this.drone.state.position, this.accumulators.gps);
      this.navigation.updateGps(this.latestGps.position, this.latestGps.variance, now);
      this.accumulators.gps = 0;
    }

    this.accumulators.baro += dt;
    if (this.accumulators.baro >= 1 / 20) {
      this.latestBaro = this.sensors.barometer(now, this.drone.state.position.y);
      this.navigation.updateBarometer(this.latestBaro.altitude, this.latestBaro.variance);
      this.accumulators.baro = 0;
    }

    this.navEstimate = this.navigation.estimate(
      this.attitude.orientation,
      this.drone.state.angularVelocity,
    );
    const measuredAcceleration = scale(
      sub(this.navEstimate.velocity, this.previousNavVelocity),
      1 / dt,
    );
    const filter = 1 - Math.exp(-dt / 0.28);
    this.navAcceleration = {
      x: this.navAcceleration.x + (measuredAcceleration.x - this.navAcceleration.x) * filter,
      y: this.navAcceleration.y + (measuredAcceleration.y - this.navAcceleration.y) * filter,
      z: this.navAcceleration.z + (measuredAcceleration.z - this.navAcceleration.z) * filter,
    };
    this.previousNavVelocity = this.navEstimate.velocity;

    this.accumulators.autonomy += dt;
    if (this.accumulators.autonomy >= 1 / 10) {
      this.autonomyOutput = this.autonomy.update(
        now,
        this.accumulators.autonomy,
        this.navEstimate,
        this.track,
        this.drone.telemetry().batteryPercent,
        this.drone.state.onGround,
        this.drone.state.crashed,
      );
      this.accumulators.autonomy = 0;
      this.handleMissionEvents();
    }

    if (!this.drone.state.crashed) {
      this.accumulators.control += dt;
      if (this.accumulators.control >= 1 / 100) {
        this.controlOutput = this.controller.update(
          this.navEstimate,
          this.autonomyOutput.command,
          this.accumulators.control,
          this.drone.params.mass,
        );
        this.drone.command({
          thrust: this.controlOutput.thrust,
          torque: this.controlOutput.torque,
        });
        this.accumulators.control = 0;
      }
    }

    this.drone.step(dt, wind, this.world.groundHeight(this.drone.state.position.x, this.drone.state.position.z));

    this.accumulators.collision += dt;
    if (this.accumulators.collision >= 1 / 60) {
      this.accumulators.collision = 0;
      if (!this.drone.state.crashed) {
        const hit = this.world.collisions(this.drone.state.position, 0.55);
        if (hit) {
          this.collisionObstacle = hit.id;
          this.drone.state.crashed = true;
          this.controller.enabled = false;
          this.drone.command({ thrust: 0, torque: V3() });
          this.log('critical', 'SAFETY', `Airframe collision with static object "${hit.id}".`);
        } else if (this.drone.state.crashed) {
          this.collisionObstacle = 'ground';
          this.log('critical', 'SAFETY', 'Airframe ground impact exceeded 4.5 m/s.');
        }
      }
    }
    if (this.autonomyOutput.telemetry.phase === 'COMPLETE' && !this.completeLogged) {
      this.completeLogged = true;
      this.drone.disarm();
      this.controller.enabled = false;
    }

    this.time += dt;
    this.stepIndex += 1;
  }

  setBehavior(behavior: 'PURSUIT' | 'OVERWATCH'): void {
    if (this.autonomy.behavior === behavior) return;
    this.autonomy.setBehavior(behavior);
    this.log('info', 'OPERATOR', `Follow behaviour set to ${behavior}.`);
  }

  setStandoff(meters: number): void {
    this.autonomy.setStandoff(meters);
  }

  setWind(speed: number, fromDegrees: number): void {
    if (
      Math.abs(this.world.wind.meanSpeed - speed) < 0.01 &&
      Math.abs(this.world.wind.fromCompassDegrees - fromDegrees) < 0.1
    ) {
      return;
    }
    this.world.wind.setBase(speed, fromDegrees);
    this.log('info', 'WEATHER', `Wind injection set to ${speed.toFixed(1)} m/s from ${fromDegrees.toFixed(0)}°.`);
  }

  getSnapshot(): SimulationSnapshot {
    const droneTelemetry = this.drone.telemetry();
    const euler = quatToEuler(this.drone.state.orientation);
    const track = this.track;
    const targetRange = track.initialized ? distance(this.navEstimate.position, track.position) : 0;
    const dx = track.position.x - this.navEstimate.position.x;
    const dz = track.position.z - this.navEstimate.position.z;
    const targetBearing = track.initialized ? Math.atan2(dx, -dz) : 0;
    const mission = {
      ...this.autonomyOutput.telemetry,
      targetRange: targetRange || this.autonomyOutput.telemetry.targetRange,
      targetBearing,
    };
    return {
      time: this.time,
      scenarioId: this.scenario.id,
      drone: {
        position: this.drone.state.position,
        velocity: this.drone.state.velocity,
        orientation: this.drone.state.orientation,
        angularVelocity: this.drone.state.angularVelocity,
        speed: droneTelemetry.speed,
        altitude: droneTelemetry.altitude,
        agl: droneTelemetry.agl,
        horizontalSpeed: droneTelemetry.horizontalSpeed,
        verticalSpeed: droneTelemetry.verticalSpeed,
        roll: euler.roll,
        pitch: euler.pitch,
        yaw: euler.yaw,
        heading: compassDegrees(euler.yaw),
        throttle: droneTelemetry.throttle,
        batteryPercent: droneTelemetry.batteryPercent,
        voltage: droneTelemetry.voltage,
        current: droneTelemetry.current,
        motors: [...this.drone.state.motorThrust] as [number, number, number, number],
        armed: this.drone.state.armed,
        onGround: this.drone.state.onGround,
        crashed: this.drone.state.crashed,
      },
      estimate: this.navEstimate,
      targetTruth: {
        position: this.target.state.position,
        velocity: this.target.velocity,
        speed: this.target.state.speed,
        heading: -this.target.state.heading,
        odometer: this.target.state.odometer,
        routeProgress: this.target.state.distanceAlongRoute / this.route.length,
        lateralError: this.target.state.lateralError,
      },
      perception: {
        trackStatus: track.status,
        trackPosition: track.position,
        trackVelocity: track.velocity,
        confidence: track.confidence,
        updates: track.updates,
        timeSinceUpdate: track.timeSinceUpdate,
        trackInitialized: track.initialized,
        covarianceTrace: track.covarianceTrace,
        detection: {
          visible: this.detection.visible,
          inFov: this.detection.inFov,
          occluded: this.detection.occluded,
          tooFar: this.detection.tooFar,
          range: this.detection.range,
          bearing: this.detection.bearing,
          elevation: this.detection.elevation,
          screenX: this.detection.screenX,
          screenY: this.detection.screenY,
          laserValid: this.detection.laserValid,
          confidence: this.detection.confidence,
        },
        gimbal: {
          position: this.gimbalPose.position,
          orientation: this.gimbalPose.orientation,
          yaw: this.gimbalPose.yaw,
          pitch: this.gimbalPose.pitch,
          fovHorizontal: this.gimbalPose.fovHorizontal,
          fovVertical: this.gimbalPose.fovVertical,
          yawRate: this.gimbal.yawRate,
          pitchRate: this.gimbal.pitchRate,
        },
        targetBearing,
        targetRange,
      },
      mission,
      plannedPath: this.autonomy.plannedPath.length > 0 ? this.autonomy.plannedPath : [this.navEstimate.position],
      command: {
        position: this.autonomyOutput.command.position,
        velocity: this.autonomyOutput.command.velocity,
        acceleration: this.autonomyOutput.command.acceleration,
        yaw: this.autonomyOutput.command.yaw,
        yawRate: this.autonomyOutput.command.yawRate,
      },
      control: {
        thrust: this.controlOutput.thrust,
        torque: this.controlOutput.torque,
        saturated: this.controlOutput.saturated,
        desiredOrientation: this.controlOutput.desiredOrientation,
        desiredAngularVelocity: this.controlOutput.desiredAngularVelocity,
      },
      planner: {
        status: this.autonomyOutput.telemetry.plannerStatus,
        clearance: this.autonomyOutput.telemetry.plannerClearance,
        replans: this.autonomyOutput.telemetry.replans,
        candidateCount: this.autonomyOutput.telemetry.candidateCount,
      },
      wind: {
        vector: this.world.wind.sample(),
        speed: this.world.wind.currentSpeed,
        meanSpeed: this.world.wind.meanSpeed,
        fromDegrees: this.world.wind.fromCompassDegrees,
      },
      sensors: {
        satellites: this.latestGps?.satellites ?? 0,
        hdop: this.latestGps?.hdop ?? 0,
        gpsNis: this.navEstimate.gpsNis,
        baroNis: this.navigation.baroNis,
        positionSigma: this.navEstimate.positionSigma,
        velocitySigma: this.navEstimate.velocitySigma,
        accelRejected: this.attitude.accelRejected,
        magRejected: this.attitude.magRejected,
        gpsAge: this.latestGps ? this.time - this.latestGps.time : 0,
      },
      collision: this.collisionObstacle,
      events: [...this.events],
    };
  }

  get currentMission(): AutonomyOutput {
    return this.autonomyOutput;
  }

  get currentTrack(): TargetTrack {
    return this.track;
  }

  private handleMissionEvents(): void {
    const phase = this.autonomyOutput.telemetry.phase;
    if (phase !== this.lastPhase) {
      const message = PHASE_MESSAGES[phase];
      if (phase !== 'FAILED' || !this.drone.state.crashed) {
        this.log(message.severity, 'AUTONOMY', message.message);
      }
      this.lastPhase = phase;
    }
    const status = this.track.status;
    if (status !== this.lastTrackStatus) {
      if (status === 'TRACKING' && !this.lockLogged) {
        this.lockLogged = true;
        this.log(
          'success',
          'PERCEPTION',
          `Tracker converged after ${this.track.updates} visual updates.`,
        );
      }
      if (status === 'COASTING' && !this.coastLogged) {
        this.coastLogged = true;
        this.log('warn', 'PERCEPTION', 'Visual measurement gap — track propagating on motion model.');
      }
      if (status === 'LOST' && !this.lostLogged) {
        this.lostLogged = true;
        this.log('warn', 'PERCEPTION', 'Target track exceeded coast horizon.');
      }
      if (status === 'TRACKING') {
        this.coastLogged = false;
        this.lostLogged = false;
      }
      this.lastTrackStatus = status;
    }

    if (this.track.initialized && !this.motionLogged && this.track.age > 2) {
      const speed = Math.hypot(this.track.velocity.x, this.track.velocity.z);
      if (speed > 2.5 && this.track.timeSinceUpdate < 0.3) {
        this.motionLogged = true;
        this.log('info', 'PERCEPTION', `Subject motion detected at ${speed.toFixed(1)} m/s.`);
      }
    }
    if (phase === 'TRACK' && this.track.initialized && !this.standoffLogged) {
      const horizontal = Math.hypot(
        this.track.position.x - this.drone.state.position.x,
        this.track.position.z - this.drone.state.position.z,
      );
      if (Math.abs(horizontal - this.autonomy.standoff) < 4 && this.track.timeSinceUpdate < 0.35) {
        this.standoffLogged = true;
        this.log(
          'success',
          'GUIDANCE',
          `Standoff geometry established at ${this.autonomy.standoff.toFixed(0)} m.`,
        );
      }
    }
    const plannerStatus = this.autonomyOutput.telemetry.plannerStatus;
    if (!this.plannerIssueLogged && (plannerStatus === 'EMERGENCY' || plannerStatus === 'BLOCKED')) {
      this.plannerIssueLogged = true;
      this.log('warn', 'GUIDANCE', `Local planner entered ${plannerStatus.toLowerCase()} avoidance.`);
    } else if (this.plannerIssueLogged && plannerStatus === 'CLEAR') {
      this.plannerIssueLogged = false;
      this.log('success', 'GUIDANCE', 'Planner recovered a clear corridor.');
    }
  }

  private log(severity: EventSeverity, source: string, message: string): void {
    this.events.push({
      id: this.eventId,
      time: this.time,
      severity,
      source,
      message,
    });
    this.eventId += 1;
    if (this.events.length > 48) this.events.shift();
  }
}

export const createSimulation = (scenarioId: string): Simulation => new Simulation(scenarioId);

