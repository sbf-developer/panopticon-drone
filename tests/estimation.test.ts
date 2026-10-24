import { describe, expect, it } from 'vitest';
import { TargetTracker } from '../src/core/sim/estimator';
import { V3 } from '../src/core/math/vec3';

describe('target tracker', () => {
  it('converges to a constant-velocity target from noisy position measurements', () => {
    const tracker = new TargetTracker();
    let x = 10;
    let z = -4;
    for (let i = 0; i < 400; i += 1) {
      const t = i * 0.05;
      x = 10 + 3.2 * t;
      z = -4 + 1.1 * t;
      const noiseX = Math.sin(i * 2.17) * 0.16;
      const noiseZ = Math.cos(i * 1.73) * 0.16;
      tracker.update(V3(x + noiseX, 1.2, z + noiseZ), V3(0.25, 0.3, 0.25), t);
      tracker.predict(0.05, t + 0.05);
    }
    const track = tracker.track(20.05);
    expect(track.initialized).toBe(true);
    expect(track.velocity.x).toBeGreaterThan(2.6);
    expect(track.velocity.x).toBeLessThan(3.8);
    expect(track.velocity.z).toBeGreaterThan(0.6);
    expect(track.velocity.z).toBeLessThan(1.6);
    expect(track.position.x).toBeGreaterThan(70);
    expect(track.confidence).toBeGreaterThan(0.3);
  });

  it('reports a lost track after the coast horizon', () => {
    const tracker = new TargetTracker();
    tracker.update(V3(5, 1, 2), V3(0.4, 0.4, 0.4), 0);
    tracker.predict(3.2, 3.2);
    const track = tracker.track(3.2);
    expect(track.status).toBe('LOST');
  });
});
