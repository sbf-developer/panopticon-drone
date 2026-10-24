import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoutePath, type RouteSample } from '../core/world/path';
import type { ScenarioDefinition } from '../core/world/types';
import { Rng } from '../core/math/random';
import { createBuilding, createProp, createTreeInstances } from './models';
import {
  makeCloudTexture,
  makeGroundTexture,
  makeHelipadTexture,
  makeRoadTexture,
} from './textures';

const sunDirection = (elevationDeg: number, azimuthDeg: number): THREE.Vector3 => {
  const elevation = (elevationDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    -Math.cos(azimuth) * Math.cos(elevation),
  );
};

interface RibbonOptions {
  width: number;
  y: number;
  centerOffset?: number;
  uvScale?: number;
}

const buildRibbon = (
  samples: readonly RouteSample[],
  options: RibbonOptions,
): THREE.BufferGeometry => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const count = samples.length;
  for (let i = 0; i < count; i += 1) {
    const sample = samples[i]!;
    const next = samples[(i + 1) % count]!;
    const prev = samples[(i - 1 + count) % count]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length;
    const nz = dx / length;
    const offset = options.centerOffset ?? 0;
    const half = options.width / 2;
    positions.push(
      sample.x + nx * (offset + half),
      options.y,
      sample.z + nz * (offset + half),
      sample.x + nx * (offset - half),
      options.y,
      sample.z + nz * (offset - half),
    );
    const v = sample.s / (options.uvScale ?? 12);
    uvs.push(0, v, 1, v);
  }
  for (let i = 0; i < count; i += 1) {
    const base = i * 2;
    const next = ((i + 1) % count) * 2;
    indices.push(base, next, base + 1, base + 1, next, next + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const buildRoad = (scenario: ScenarioDefinition, samples: readonly RouteSample[]): THREE.Group => {
  const group = new THREE.Group();
  const texture = makeRoadTexture(
    scenario.theme.road,
    scenario.theme.roadEdge,
    scenario.seed,
    scenario.theme.roadKind === 'dirt',
  );
  const geometry = buildRibbon(samples, { width: scenario.roadWidth, y: 0.045, uvScale: 10 });
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.96,
    metalness: 0.02,
    color: scenario.theme.roadKind === 'dirt' ? 0xd2c2a5 : 0xffffff,
  });
  const road = new THREE.Mesh(geometry, material);
  road.receiveShadow = true;
  group.add(road);

  for (const side of [-1, 1]) {
    const edgeGeometry = buildRibbon(samples, {
      width: 0.45,
      y: 0.06,
      centerOffset: side * (scenario.roadWidth / 2 - 0.28),
      uvScale: 8,
    });
    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: scenario.theme.roadEdge,
      roughness: 0.85,
    });
    const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);
    edge.receiveShadow = true;
    group.add(edge);
  }

  if (scenario.theme.roadKind === 'asphalt') {
    const dashGeometry = new THREE.PlaneGeometry(0.18, 3.0);
    const dashMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8dfbc,
      roughness: 0.7,
      emissive: 0x1a180d,
      emissiveIntensity: 0.2,
    });
    const dashes: number[] = [];
    let distance = 0;
    while (distance < samples[samples.length - 1]!.s) {
      dashes.push(distance);
      distance += 11;
    }
    const mesh = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashes.length);
    const matrix = new THREE.Matrix4();
    dashes.forEach((s, i) => {
      const index = Math.min(samples.length - 1, Math.floor(s / 1.5));
      const sample = samples[index]!;
      const next = samples[Math.min(samples.length - 1, index + 1)]!;
      const yaw = Math.atan2(-(next.x - sample.x), -(next.z - sample.z));
      const quaternion = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      matrix.compose(
        new THREE.Vector3(sample.x, 0.07, sample.z),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      mesh.setMatrixAt(i, matrix);
    });
    group.add(mesh);
  }
  return group;
};

const createHelipad = (scenario: ScenarioDefinition): THREE.Group => {
  const group = new THREE.Group();
  group.position.set(scenario.drone.home.x, 0.06, scenario.drone.home.z);
  const texture = makeHelipadTexture();
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(7.5, 64),
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.85, metalness: 0.08 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.receiveShadow = true;
  group.add(pad);

  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0xd88937,
    emissive: 0xd88937,
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    const light = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.12, 8), ringMaterial);
    light.position.set(Math.cos(angle) * 8.1, 0.05, Math.sin(angle) * 8.1);
    group.add(light);
  }
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6),
    new THREE.MeshStandardMaterial({
      color: 0x5fd6c0,
      emissive: 0x2fbfa8,
      emissiveIntensity: 1.8,
      transparent: true,
      opacity: 0.7,
    }),
  );
  beacon.position.set(0, 1.6, 8.8);
  group.add(beacon);
  return group;
};

const createStreetlights = (samples: readonly RouteSample[], roadWidth: number): THREE.Group => {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x343b3e, roughness: 0.55, metalness: 0.55 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff1c0,
    emissive: 0xffd78a,
    emissiveIntensity: 0.9,
    roughness: 0.4,
  });
  const step = 42;
  const total = samples[samples.length - 1]!.s;
  let index = 0;
  for (let s = 10; s < total; s += step) {
    const sample = samples[Math.min(samples.length - 1, Math.floor(s / 1.5))]!;
    const next = samples[Math.min(samples.length - 1, Math.floor(s / 1.5) + 1)]!;
    const dx = next.x - sample.x;
    const dz = next.z - sample.z;
    const tangentLength = Math.hypot(dx, dz) || 1;
    const nx = -dz / tangentLength;
    const nz = dx / tangentLength;
    const side = index % 2 === 0 ? 1 : -1;
    const offset = (roadWidth / 2 + 1.4) * side;
    const base = new THREE.Vector3(sample.x + nx * offset, 0, sample.z + nz * offset);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 7.2, 6), poleMat);
    pole.position.set(base.x, 3.6, base.z);
    group.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.08), poleMat);
    arm.position.set(base.x - nx * offset * 0.08, 7.0, base.z - nz * offset * 0.08);
    arm.rotation.y = Math.atan2(-nx, -nz);
    group.add(arm);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.24), lampMat);
    lamp.position.set(base.x - nx * 0.55 * side, 6.95, base.z - nz * 0.55 * side);
    group.add(lamp);
    index += 1;
  }
  return group;
};

const createParkedCars = (scenario: ScenarioDefinition, rng: Rng): THREE.Group => {
  const group = new THREE.Group();
  const colors = [0x7d8a8f, 0xa74e3c, 0x394a59, 0xb9b3a3, 0x485c42];
  for (let i = 0; i < 9; i += 1) {
    const building = scenario.buildings[rng.int(0, scenario.buildings.length - 1)]!;
    if (building.style === 'silo') continue;
    const side = rng.chance(0.5) ? 1 : -1;
    const x = building.x + rng.range(-building.width * 0.7, building.width * 0.7);
    const z = building.z + side * (building.depth / 2 + rng.range(4, 9));
    const car = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({
      color: colors[i % colors.length]!,
      roughness: 0.45,
      metalness: 0.4,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.55, 4.1), paint);
    body.position.y = 0.65;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.5, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x1b2a31, roughness: 0.2, metalness: 0.5 }),
    );
    cabin.position.set(0, 1.1, 0.1);
    car.add(body, cabin);
    for (const [wx, wz] of [
      [-0.9, -1.3],
      [0.9, -1.3],
      [-0.9, 1.3],
      [0.9, 1.3],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0x121415, roughness: 0.9 }));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.36, wz);
      car.add(wheel);
    }
    car.position.set(x, 0, z);
    car.rotation.y = rng.range(0, Math.PI * 2);
    car.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    group.add(car);
  }
  return group;
};

const createDistantTerrain = (scenario: ScenarioDefinition): THREE.Group => {
  const group = new THREE.Group();
  const rng = new Rng(scenario.seed ^ 0xabc123);
  const count = scenario.id === 'ridge' ? 18 : 13;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const distance = rng.range(520, 760);
    const radius = rng.range(80, 190);
    const height = rng.range(48, scenario.id === 'ridge' ? 145 : 95);
    const geometry = new THREE.ConeGeometry(radius, height, rng.int(5, 7), 1);
    const color = new THREE.Color(scenario.theme.groundAccent)
      .lerp(new THREE.Color(scenario.theme.fog), 0.48)
      .offsetHSL(0, -0.12, rng.range(-0.06, 0.03));
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    const mountain = new THREE.Mesh(geometry, material);
    mountain.position.set(
      Math.cos(angle) * distance,
      height / 2 - 22,
      Math.sin(angle) * distance,
    );
    mountain.rotation.y = rng.range(0, Math.PI * 2);
    mountain.receiveShadow = false;
    group.add(mountain);
  }
  return group;
};

const createClouds = (scenario: ScenarioDefinition): THREE.Group => {
  const group = new THREE.Group();
  const rng = new Rng(scenario.seed ^ 0x0f0f0f);
  const texture = makeCloudTexture(scenario.seed);
  for (let i = 0; i < 12; i += 1) {
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: rng.range(0.08, 0.22),
      depthWrite: false,
      fog: true,
    });
    const sprite = new THREE.Sprite(material);
    const angle = rng.range(0, Math.PI * 2);
    const radius = rng.range(180, 520);
    sprite.position.set(
      Math.cos(angle) * radius,
      rng.range(100, 240),
      Math.sin(angle) * radius,
    );
    const width = rng.range(110, 240);
    sprite.scale.set(width, width * 0.42, 1);
    group.add(sprite);
  }
  return group;
};

export interface EnvironmentScene {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  sky: Sky;
  ground: THREE.Mesh;
}

export const buildEnvironment = (
  scenario: ScenarioDefinition,
  renderer: THREE.WebGLRenderer,
): EnvironmentScene => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(scenario.theme.fog, scenario.theme.fogDensity);
  scene.background = new THREE.Color(scenario.theme.horizon);

  const sky = new Sky();
  sky.scale.setScalar(1200);
  const sunDir = sunDirection(scenario.theme.sunElevationDeg, scenario.theme.sunAzimuthDeg);
  const uniforms = sky.material.uniforms;
  (uniforms.sunPosition?.value as THREE.Vector3).copy(sunDir);
  uniforms.turbidity!.value = scenario.id === 'canopy' ? 7.5 : 4.2;
  uniforms.rayleigh!.value = scenario.id === 'canopy' ? 2.2 : 1.35;
  uniforms.mieCoefficient!.value = 0.005;
  uniforms.mieDirectionalG!.value = 0.82;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xc7dbe4, 0x5a5848, scenario.theme.ambientIntensity + 0.28);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.24);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(
    scenario.theme.sunElevationDeg < 25 ? 0xffc58f : 0xfff2df,
    scenario.theme.sunElevationDeg < 25 ? 2.4 : 3.0,
  );
  sun.position.copy(sunDir).multiplyScalar(220);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -155;
  sun.shadow.camera.right = 155;
  sun.shadow.camera.top = 155;
  sun.shadow.camera.bottom = -155;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.02;
  sun.shadow.camera.layers.enable(2);
  scene.add(sun);
  scene.add(sun.target);

  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const groundTexture = makeGroundTexture(
    scenario.theme.ground,
    scenario.theme.groundAccent,
    scenario.seed,
    scenario.id === 'ridge',
  );
  groundTexture.repeat.set(42, 42);
  groundTexture.anisotropy = anisotropy;
  const groundMaterial = new THREE.MeshStandardMaterial({
    map: groundTexture,
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(320, 64, 0x8c948d, 0x8c948d);
  const gridMaterial = grid.material as THREE.LineBasicMaterial;
  gridMaterial.opacity = 0.035;
  gridMaterial.transparent = true;
  grid.position.y = 0.012;
  scene.add(grid);

  const route = new RoutePath(scenario.route, 1.5);
  scene.add(buildRoad(scenario, route.samples));
  if (scenario.theme.roadKind === 'asphalt') {
    scene.add(createStreetlights(route.samples, scenario.roadWidth));
  }
  scene.add(createHelipad(scenario));
  scene.add(createDistantTerrain(scenario));
  scene.add(createClouds(scenario));

  const trees = createTreeInstances(scenario.trees, scenario.theme);
  scene.add(trees);

  const rng = new Rng(scenario.seed ^ 0xa11ce);
  scenario.buildings.forEach((building, index) => {
    scene.add(createBuilding(building, scenario.theme, index * 97 + rng.int(0, 50)));
  });
  for (const prop of scenario.props) scene.add(createProp(prop));
  scene.add(createParkedCars(scenario, rng));

  // A subtle vignette-like ring of darker ground around the play area helps the
  // eye distinguish the operational arena from the distant scenery.
  const ringGeometry = new THREE.RingGeometry(185, 420, 96);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: scenario.theme.groundAccent,
    transparent: true,
    opacity: 0.13,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  return { scene, sun, sky, ground };
};
