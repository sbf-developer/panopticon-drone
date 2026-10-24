import { describe, expect, it } from 'vitest';
import { FlightController, type EstimatedFlightState } from '../src/core/sim/controller';
import { Quadrotor } from '../src/core/sim/drone';
import { Simulation } from '../src/core/sim/simulation';
import { V3, distance, horizontalLength } from '../src/core/math/vec3';

describe('quadrotor flight controller', () => {
  it('holds a hover setpoint against sensor-clean dynamics', () => {
    const drone = new Quadrotor();
    drone.reset(V3(0, 10, 0), 0);
    drone.arm();
    const controller = new FlightController();
    const command = {
      position: V3(0, 10, 0),
      velocity: V3(),
      acceleration: V3(),
      yaw: 0,
      yawRate: 0,
    };
    for (let i = 0; i < 2400; i += 1) {
      if (i % 2 === 0) {
        const state: EstimatedFlightState = {
          position: drone.state.position,
          velocity: drone.state.velocity,
          orientation: drone.state.orientation,
          angularVelocity: drone.state.angularVelocity,
        };
        const control = controller.update(state, command, 1 / 100);
        drone.command(control);
      }
      drone.step(1 / 240, V3());
    }
    expect(drone.state.position.y).toBeGreaterThan(9.4);
    expect(drone.state.position.y).toBeLessThan(10.6);
    expect(Math.abs(drone.state.position.x)).toBeLessThan(1);
    expect(drone.state.crashed).toBe(false);
  });
});

const scenarios = [
  { id: 'campus', name: 'Ridgeway Campus' },
  { id: 'canopy', name: 'Blackpine Corridor' },
  { id: 'ridge', name: 'Dry Creek Range' },
] as const;

describe.each(scenarios)('closed-loop autonomy: $name', ({ id }) => {
  it('launches, acquires, and follows the subject without leaving the safety envelope', () => {
    const sim = new Simulation(id);
    for (let i = 0; i < 60 * 240; i += 1) sim.step();
    const s = sim.getSnapshot();
    const standoffError = Math.abs(
      horizontalLength({
        x: s.drone.position.x - s.perception.trackPosition.x,
        y: 0,
        z: s.drone.position.z - s.perception.trackPosition.z,
      }) - s.mission.standoff,
    );
    const trackerError = distance(s.perception.trackPosition, s.targetTruth.position);
    expect(s.drone.crashed).toBe(false);
    expect(s.mission.phase).toBe('TRACK');
    expect(s.perception.trackStatus).not.toBe('SEARCHING');
    expect(standoffError).toBeLessThan(20);
    expect(trackerError).toBeLessThan(9);
    expect(s.drone.batteryPercent).toBeGreaterThan(50);
    expect(s.events.some((event) => event.severity === 'critical')).toBe(false);
  });
});

describe('determinism', () => {
  it('produces identical state for the same scenario and seed', () => {
    const a = new Simulation('campus');
    const b = new Simulation('campus');
    for (let i = 0; i < 12 * 240; i += 1) {
      a.step();
      b.step();
    }
    const sa = a.getSnapshot();
    const sb = b.getSnapshot();
    expect(sb.time).toBeCloseTo(sa.time, 9);
    expect(sb.drone.position.x).toBeCloseTo(sa.drone.position.x, 9);
    expect(sb.drone.position.z).toBeCloseTo(sa.drone.position.z, 9);
    expect(sb.targetTruth.position.x).toBeCloseTo(sa.targetTruth.position.x, 9);
    expect(sb.targetTruth.position.z).toBeCloseTo(sa.targetTruth.position.z, 9);
  });
});
