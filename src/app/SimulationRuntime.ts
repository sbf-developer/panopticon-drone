import { Simulation, SIM_DT } from '../core/sim/simulation';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import { SimulationView, type CameraMode, type DebugOptions } from '../render/SimulationView';
import type { FollowBehavior } from '../core/sim/mission';

export interface RuntimeStats {
  fps: number;
  simRate: number;
  paused: boolean;
  speed: number;
  wallTime: number;
}

export type RuntimeListener = (snapshot: SimulationSnapshot, stats: RuntimeStats) => void;

/**
 * Owns the fixed-step simulation and the render loop. React only receives a
 * throttled snapshot; all high-frequency work stays outside the component tree.
 */
export class SimulationRuntime {
  private sim: Simulation;
  private readonly view: SimulationView;
  private listener: RuntimeListener | null = null;
  private frameHandle = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private snapshotAccumulator = 0;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private fps = 0;
  private wallTime = 0;
  private running = true;
  paused = false;
  speed = 1;
  private error: Error | null = null;

  constructor(scenarioId: string, listener?: RuntimeListener) {
    this.sim = new Simulation(scenarioId);
    this.view = new SimulationView(this.sim.scenario);
    this.listener = listener ?? null;
    if (import.meta.env.DEV) {
      (globalThis as unknown as { __sentinel?: SimulationRuntime }).__sentinel = this;
    }
    this.frameHandle = requestAnimationFrame(this.loop);
  }

  setListener(listener: RuntimeListener): void {
    this.listener = listener;
    this.publish();
  }

  attach(container: HTMLElement, feedCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement): void {
    this.view.attach(container, feedCanvas, overlayCanvas);
    this.publish();
  }

  detach(): void {
    this.view.detach();
  }

  setScenario(scenarioId: string): void {
    const next = new Simulation(scenarioId);
    this.sim = next;
    this.view.setScenario(next.scenario);
    this.view.resetTrail();
    this.accumulator = 0;
    this.publish();
  }

  reset(): void {
    this.sim.reset();
    this.view.resetTrail();
    this.accumulator = 0;
    this.publish();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.publish();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.publish();
  }

  setCameraMode(mode: CameraMode): void {
    this.view.setCameraMode(mode);
  }

  setDebug(options: Partial<DebugOptions>): void {
    this.view.setDebug(options);
  }

  setBehavior(behavior: FollowBehavior): void {
    this.sim.setBehavior(behavior);
  }

  setStandoff(meters: number): void {
    this.sim.setStandoff(meters);
  }

  setWind(speed: number, fromDegrees: number): void {
    this.sim.setWind(speed, fromDegrees);
  }

  getSnapshot(): SimulationSnapshot {
    return this.sim.getSnapshot();
  }

  getError(): Error | null {
    return this.error;
  }

  /** Development/QA helper: advance the fixed-step core without waiting on rAF. */
  advance(seconds: number): void {
    const steps = Math.max(0, Math.min(240 * 240, Math.floor(seconds / SIM_DT)));
    for (let i = 0; i < steps; i += 1) this.sim.step();
    const snapshot = this.sim.getSnapshot();
    for (let i = 0; i < 18; i += 1) this.view.update(snapshot, 0.1);
    this.view.render(0.1);
    this.publish(snapshot);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    this.view.detach();
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.loop);
    if (!this.lastFrame) this.lastFrame = now;
    const realDelta = Math.max(0, (now - this.lastFrame) / 1000);
    const rawDt = Math.min(0.06, realDelta);
    this.lastFrame = now;
    this.wallTime += realDelta;
    this.fpsAccumulator += realDelta;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccumulator;
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }

    try {
      if (!this.paused) {
        this.accumulator += rawDt * this.speed;
        let steps = 0;
        while (this.accumulator >= SIM_DT && steps < 48) {
          this.sim.step();
          this.accumulator -= SIM_DT;
          steps += 1;
        }
        if (steps >= 48) this.accumulator = 0;
      }
      const snapshot = this.sim.getSnapshot();
      const visualDt = this.paused ? 0 : rawDt * this.speed;
      this.view.update(snapshot, visualDt);
      this.view.render(rawDt);
      this.snapshotAccumulator += rawDt;
      if (this.snapshotAccumulator >= 1 / 15) {
        this.snapshotAccumulator = 0;
        this.publish(snapshot);
      }
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.running = false;
      // eslint-disable-next-line no-console
      console.error('Simulation loop stopped', error);
    }
  };

  private publish(snapshot = this.sim.getSnapshot()): void {
    this.listener?.(snapshot, {
      fps: this.fps,
      simRate: 240,
      paused: this.paused,
      speed: this.speed,
      wallTime: this.wallTime,
    });
  }
}
