import { describe, expect, it } from 'vitest';
import { RoutePath } from '../src/core/world/path';
import { World, obstacleClearance, segmentIntersectsBox } from '../src/core/world/environment';
import { getScenario, getScenarios } from '../src/core/world/scenarios';
import { V3 } from '../src/core/math/vec3';

describe('route path', () => {
  it('builds a closed arc-length parameterised loop', () => {
    const route = new RoutePath(
      [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
        { x: 100, z: 100 },
        { x: 0, z: 100 },
      ],
      1,
    );
    expect(route.length).toBeGreaterThan(390);
    expect(route.length).toBeLessThan(430);
    const p0 = route.pointAt(0);
    const p1 = route.pointAt(route.length);
    expect(Math.hypot(p0.x - p1.x, p0.z - p1.z)).toBeLessThan(2);
    const closest = route.closest(50, -4);
    expect(closest.distance).toBeGreaterThan(2);
    expect(closest.distance).toBeLessThan(14);
  });

  it('provides a deterministic scenario catalogue', () => {
    const scenarios = getScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(3);
    for (const scenario of scenarios) {
      expect(scenario.route.length).toBeGreaterThan(6);
      expect(scenario.buildings.length).toBeGreaterThan(0);
      expect(scenario.trees.length).toBeGreaterThan(20);
      expect(scenario.drone.cruiseAltitude).toBeGreaterThan(8);
    }
  });
});

describe('world geometry', () => {
  const scenario = getScenario('campus');
  const world = new World(scenario);

  it('detects collision geometry and line-of-sight occlusion', () => {
    const building = scenario.buildings[0]!;
    const center = V3(building.x, building.height / 2, building.z);
    expect(obstacleClearance({
      kind: 'box',
      id: building.id,
      centerX: building.x,
      centerZ: building.z,
      halfWidth: building.width / 2,
      halfDepth: building.depth / 2,
      height: building.height,
    }, center)).toBeLessThan(0);
    expect(
      world.segmentBlocked(
        V3(building.x - building.width, 4, building.z),
        V3(building.x + building.width, 4, building.z),
      ),
    ).toBe(true);
    expect(world.segmentBlocked(V3(0, 80, 0), V3(20, 80, 20))).toBe(false);
  });

  it('exposes a stable wind vector from a compass origin', () => {
    const windWorld = new World(getScenario('ridge'));
    windWorld.wind.setBase(8, 270);
    const wind = windWorld.wind.sample();
    expect(wind.x).toBeGreaterThan(0.2);
    expect(windWorld.wind.fromCompassDegrees).toBeCloseTo(270, 0);
  });

  it('detects segment/AABB intersection', () => {
    const hit = segmentIntersectsBox(V3(-10, 5, 0), V3(10, 5, 0), {
      kind: 'box',
      id: 'test',
      centerX: 0,
      centerZ: 0,
      halfWidth: 2,
      halfDepth: 2,
      height: 10,
    });
    expect(hit).toBe(true);
  });
});
