import * as THREE from 'three';
import type { BuildingSpec, SceneTheme, TargetScenarioSpec, TreeSpec, PropSpec } from '../core/world/types';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import { quatToThree } from './math';
import { makeFacadeTexture, makeLabelTexture, type FacadeKind } from './textures';
import { Rng } from '../core/math/random';

const shadowify = (object: THREE.Object3D): void => {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
};

const standard = (color: THREE.ColorRepresentation, roughness = 0.7, metalness = 0.1): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const facadeKind = (style: BuildingSpec['style']): FacadeKind => {
  switch (style) {
    case 'warehouse':
      return 'warehouse';
    case 'cabin':
      return 'wood';
    case 'barn':
      return 'barn';
    case 'silo':
      return 'metal';
    default:
      return 'office';
  }
};

export class DroneModel {
  readonly root = new THREE.Group();
  readonly gimbalHead = new THREE.Group();
  private readonly propellers: THREE.Group[] = [];
  private readonly blurDiscs: THREE.Mesh[] = [];
  private readonly ledRed: THREE.MeshStandardMaterial;
  private readonly ledGreen: THREE.MeshStandardMaterial;
  private readonly motorBells: THREE.Mesh[] = [];
  private rootOrientation = new THREE.Quaternion();
  private elapsed = 0;

  constructor() {
    const carbon = standard(0x171b1f, 0.42, 0.55);
    const carbonMatte = standard(0x23292f, 0.6, 0.18);
    const metal = standard(0x8b949c, 0.3, 0.82);
    const darkMetal = standard(0x30373d, 0.45, 0.65);
    const accent = standard(0xe8793b, 0.48, 0.25);
    const lens = new THREE.MeshStandardMaterial({
      color: 0x050708,
      roughness: 0.12,
      metalness: 0.75,
      emissive: 0x1b3d4b,
      emissiveIntensity: 0.45,
    });
    this.ledRed = new THREE.MeshStandardMaterial({
      color: 0xff3b2f,
      emissive: 0xff2418,
      emissiveIntensity: 2.2,
      roughness: 0.3,
    });
    this.ledGreen = new THREE.MeshStandardMaterial({
      color: 0x39ff9e,
      emissive: 0x17ff86,
      emissiveIntensity: 2.2,
      roughness: 0.3,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.15, 0.52), carbon);
    body.position.y = 0.02;
    this.root.add(body);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.44), carbonMatte);
    shell.position.set(0, 0.11, 0.01);
    this.root.add(shell);
    const accentStrip = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.022, 0.06), accent);
    accentStrip.position.set(0, 0.158, -0.08);
    this.root.add(accentStrip);

    const battery = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.11, 0.3), standard(0x252b31, 0.55, 0.2));
    battery.position.set(0, -0.08, 0.06);
    this.root.add(battery);

    const armLength = 0.36;
    for (const [sx, sz] of [
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const direction = new THREE.Vector3(sx, 0, sz).normalize();
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, armLength, 8), carbon);
      arm.position.set(direction.x * armLength * 0.5, 0.03, direction.z * armLength * 0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      this.root.add(arm);

      const motorPos = new THREE.Vector3(direction.x * armLength, 0.055, direction.z * armLength);
      const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.074, 0.07, 16), darkMetal);
      mount.position.copy(motorPos);
      this.root.add(mount);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.055, 16), metal);
      bell.position.copy(motorPos).y += 0.055;
      this.root.add(bell);
      this.motorBells.push(bell);

      const propeller = new THREE.Group();
      propeller.position.copy(motorPos).y += 0.098;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.008, 0.045), standard(0x111519, 0.35, 0.4));
      blade.castShadow = true;
      const blade2 = blade.clone();
      blade2.rotation.y = Math.PI / 2;
      propeller.add(blade, blade2);
      this.root.add(propeller);
      this.propellers.push(propeller);

      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.27, 24),
        new THREE.MeshBasicMaterial({
          color: 0xbfd3dd,
          transparent: true,
          opacity: 0.035,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.copy(motorPos).y += 0.1;
      this.root.add(disc);
      this.blurDiscs.push(disc);
    }

    const gimbalMount = new THREE.Group();
    gimbalMount.position.set(0, -0.045, -0.25);
    const gimbalYaw = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.052, 0.055, 12), darkMetal);
    gimbalYaw.rotation.x = Math.PI / 2;
    gimbalMount.add(gimbalYaw);
    this.gimbalHead.position.set(0, 0, -0.035);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), standard(0x353d44, 0.4, 0.55));
    this.gimbalHead.add(ball);
    const lensBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.06, 16), darkMetal);
    lensBarrel.rotation.x = Math.PI / 2;
    lensBarrel.position.set(0, 0, -0.06);
    this.gimbalHead.add(lensBarrel);
    const lensGlass = new THREE.Mesh(new THREE.CircleGeometry(0.028, 20), lens);
    lensGlass.position.set(0, 0, -0.092);
    this.gimbalHead.add(lensGlass);
    gimbalMount.add(this.gimbalHead);
    this.root.add(gimbalMount);

    for (const side of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.55, 8), carbonMatte);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(side * 0.21, -0.29, 0.02);
      this.root.add(skid);
      for (const z of [-0.18, 0.18]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.22, 6), carbonMatte);
        leg.position.set(side * 0.21, -0.18, z);
        this.root.add(leg);
      }
    }

    const ledGeo = new THREE.SphereGeometry(0.018, 8, 6);
    const red = new THREE.Mesh(ledGeo, this.ledRed);
    red.position.set(-0.2, 0.05, 0.29);
    const green = new THREE.Mesh(ledGeo, this.ledGreen);
    green.position.set(0.2, 0.05, 0.29);
    const strobe = new THREE.Mesh(ledGeo, new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 3.5,
    }));
    strobe.position.set(0, -0.02, 0.3);
    this.root.add(red, green, strobe);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.18, 5), darkMetal);
    antenna.position.set(0.1, -0.2, 0.2);
    antenna.rotation.z = -0.35;
    this.root.add(antenna);

    shadowify(this.root);
    this.root.scale.setScalar(1.8);
  }

  update(snapshot: SimulationSnapshot, dt: number): void {
    this.elapsed += dt;
    this.root.position.set(
      snapshot.drone.position.x,
      snapshot.drone.position.y,
      snapshot.drone.position.z,
    );
    this.rootOrientation.copy(quatToThree(snapshot.drone.orientation));
    this.root.quaternion.copy(this.rootOrientation);
    const throttle = snapshot.drone.throttle;
    for (let i = 0; i < this.propellers.length; i += 1) {
      const motor = snapshot.drone.motors[i] ?? 0;
      const spin = 22 + (motor / 12) * 95;
      this.propellers[i]!.rotation.y += spin * dt * (i % 2 === 0 ? 1 : -1);
      const disc = this.blurDiscs[i]!;
      const material = disc.material as THREE.MeshBasicMaterial;
      material.opacity = 0.02 + Math.min(0.16, motor * 0.012);
      this.motorBells[i]!.rotation.y += spin * dt * 0.3;
    }
    const gimbal = quatToThree(snapshot.perception.gimbal.orientation);
    const local = this.rootOrientation.clone().invert().multiply(gimbal);
    this.gimbalHead.quaternion.slerp(local, Math.min(1, dt * 18));
    const pulse = 0.55 + Math.sin(this.elapsed * 6.4) * 0.25;
    this.ledRed.emissiveIntensity = pulse * 3;
    this.ledGreen.emissiveIntensity = pulse * 3;
    this.root.visible = !snapshot.drone.crashed || snapshot.drone.altitude > 0.5;
    void throttle;
  }
}

export class TargetModel {
  readonly root = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly body: THREE.Group;
  private readonly shadowBlob: THREE.Mesh;
  private wheelSpin = 0;
  private elapsed = 0;
  private readonly brakeLights: THREE.MeshStandardMaterial;

  constructor(spec: TargetScenarioSpec) {
    const paint = standard(spec.color, 0.4, 0.45);
    const dark = standard(0x1b1f22, 0.72, 0.2);
    const glass = new THREE.MeshStandardMaterial({
      color: 0x18252e,
      roughness: 0.15,
      metalness: 0.55,
      transparent: true,
      opacity: 0.92,
    });
    const chrome = standard(0xa7b0b6, 0.25, 0.9);
    this.brakeLights = new THREE.MeshStandardMaterial({
      color: 0xff3a24,
      emissive: 0xff2410,
      emissiveIntensity: 2,
    });

    this.body = new THREE.Group();
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.55, 4.25), dark);
    chassis.position.y = 0.88;
    this.body.add(chassis);
    const bedSideLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.56, 1.75), paint);
    bedSideLeft.position.set(-0.96, 1.28, 1.02);
    const bedSideRight = bedSideLeft.clone();
    bedSideRight.position.x = 0.96;
    const tailgate = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 0.12), paint);
    tailgate.position.set(0, 1.25, 1.92);
    const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 1.78), standard(0x2a2824, 0.8, 0.1));
    bedFloor.position.set(0, 1.0, 1.03);
    this.body.add(bedSideLeft, bedSideRight, tailgate, bedFloor);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.36, 1.0), paint);
    hood.position.set(0, 1.18, -1.55);
    this.body.add(hood);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.34, 0.1), dark);
    grille.position.set(0, 1.0, -2.14);
    this.body.add(grille);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.72, 1.35), paint);
    cabin.position.set(0, 1.55, -0.35);
    this.body.add(cabin);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.44, 0.05), glass);
    windshield.position.set(0, 1.68, -1.04);
    windshield.rotation.x = -0.24;
    this.body.add(windshield);
    const rearWindow = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.38, 0.05), glass);
    rearWindow.position.set(0, 1.66, 0.34);
    this.body.add(rearWindow);
    for (const side of [-1, 1]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 1.0), glass);
      window.position.set(side * 0.9, 1.66, -0.38);
      this.body.add(window);
    }
    const bumpers = [
      [0, 0.66, -2.2, 1.96, 0.18, 0.16],
      [0, 0.72, 2.2, 1.96, 0.18, 0.16],
    ] as const;
    for (const [x, y, z, w, h, d] of bumpers) {
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), chrome);
      bumper.position.set(x, y, z);
      this.body.add(bumper);
    }
    const headlight = new THREE.MeshStandardMaterial({
      color: 0xfff1c7,
      emissive: 0xffe9b0,
      emissiveIntensity: 1.7,
    });
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.06), headlight);
      lamp.position.set(side * 0.62, 1.1, -2.16);
      this.body.add(lamp);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.06), this.brakeLights);
      tail.position.set(side * 0.7, 1.26, 2.2);
      this.body.add(tail);
    }
    const lightBar = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.09, 0.18), dark);
    lightBar.position.set(0, 1.98, -0.2);
    this.body.add(lightBar);
    for (let i = 0; i < 4; i += 1) {
      const strobe = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.05, 0.07),
        new THREE.MeshStandardMaterial({
          color: i % 2 === 0 ? 0xffb03a : 0xffffff,
          emissive: i % 2 === 0 ? 0xff8a1e : 0xffffff,
          emissiveIntensity: 1.8,
        }),
      );
      strobe.position.set(-0.39 + i * 0.26, 2.04, -0.2);
      this.body.add(strobe);
    }
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.8, 5), chrome);
    antenna.position.set(-0.9, 1.85, 0.55);
    antenna.rotation.z = 0.12;
    this.body.add(antenna);

    this.root.add(this.body);
    for (const [x, z] of [
      [-0.92, -1.35],
      [0.92, -1.35],
      [-0.92, 1.35],
      [0.92, 1.35],
    ] as const) {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(x, 0.43, z);
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.32, 18), standard(0x121415, 0.88, 0.05));
      tire.rotation.z = Math.PI / 2;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.335, 12), chrome);
      rim.rotation.z = Math.PI / 2;
      wheelGroup.add(tire, rim);
      this.wheels.push(wheelGroup);
      this.root.add(wheelGroup);
    }

    const blobGeometry = new THREE.CircleGeometry(1.55, 24);
    this.shadowBlob = new THREE.Mesh(
      blobGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    this.shadowBlob.rotation.x = -Math.PI / 2;
    this.shadowBlob.position.y = 0.02;
    this.root.add(this.shadowBlob);
    shadowify(this.root);
  }

  update(snapshot: SimulationSnapshot, dt: number): void {
    this.elapsed += dt;
    const target = snapshot.targetTruth;
    this.root.position.set(target.position.x, 0.02, target.position.z);
    this.root.rotation.y = target.heading;
    this.wheelSpin += (target.speed * dt) / 0.43;
    for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;
    const throttle = Math.min(1, target.speed / 8);
    this.body.position.y = Math.sin(this.elapsed * 9) * 0.008 * throttle;
    this.body.rotation.z = Math.sin(this.elapsed * 5.2) * 0.006 * throttle;
    this.brakeLights.emissiveIntensity = target.speed < 2 ? 2.5 : 0.55;
    this.shadowBlob.position.y = 0.025;
  }
}

const gableRoof = (width: number, depth: number, rise: number, material: THREE.Material): THREE.Mesh => {
  const half = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(0, rise);
  shape.lineTo(-half, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  const roof = new THREE.Mesh(geometry, material);
  roof.castShadow = true;
  roof.receiveShadow = true;
  return roof;
};

export const createBuilding = (spec: BuildingSpec, theme: SceneTheme, seedOffset: number): THREE.Group => {
  const group = new THREE.Group();
  group.position.set(spec.x, 0, spec.z);
  const tint = new THREE.Color(spec.tint);
  const kind = facadeKind(spec.style);
  const wallTexture = makeFacadeTexture(kind, spec.tint, theme.windowGlow, spec.id.length * 991 + seedOffset);
  if (spec.style === 'office' || spec.style === 'tower') {
    wallTexture.repeat.set(Math.max(1, spec.width / 13), Math.max(1, spec.height / 11));
  } else if (spec.style === 'warehouse') {
    wallTexture.repeat.set(Math.max(1, spec.width / 10), Math.max(1, spec.height / 8));
  } else {
    wallTexture.repeat.set(Math.max(1, spec.width / 7), Math.max(1, spec.height / 6));
  }
  const wall = new THREE.MeshStandardMaterial({
    color: tint,
    map: wallTexture,
    roughness: 0.78,
    metalness: kind === 'office' ? 0.18 : 0.08,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: theme.roof,
    roughness: 0.86,
    metalness: 0.12,
  });
  const trim = standard(0xd5d1c4, 0.6, 0.22);

  if (spec.style === 'silo') {
    const radius = Math.max(2.5, spec.width / 2);
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, spec.height, 20),
      new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5, metalness: 0.65, map: wallTexture }),
    );
    body.position.y = spec.height / 2;
    group.add(body);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: tint, roughness: 0.45, metalness: 0.7 }),
    );
    dome.position.y = spec.height;
    group.add(dome);
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 0.03, 0.08, 6, 24),
      standard(0x6d6a61, 0.5, 0.5),
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = spec.height * 0.63;
    group.add(band);
    shadowify(group);
    return group;
  }

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(spec.width, spec.height, spec.depth),
    [wall, wall, roofMat, roofMat, wall, wall],
  );
  body.position.y = spec.height / 2;
  group.add(body);

  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(spec.width + 0.6, 0.45, spec.depth + 0.6),
    standard(0x55595a, 0.9, 0.05),
  );
  foundation.position.y = 0.23;
  group.add(foundation);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(spec.width + 0.5, 0.28, spec.depth + 0.5),
    roofMat,
  );
  roof.position.y = spec.height + 0.12;
  group.add(roof);

  if (spec.style === 'cabin' || spec.style === 'barn') {
    const rise = Math.min(spec.width, spec.depth) * 0.34;
    const gable = gableRoof(spec.width + 0.8, spec.depth + 0.8, rise, roofMat);
    gable.position.y = spec.height + 0.2;
    group.add(gable);
    if (spec.style === 'barn') {
      const door = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.36, spec.height * 0.55, 0.08), standard(0x4b3021, 0.9, 0.05));
      door.position.set(0, spec.height * 0.31, -spec.depth / 2 - 0.05);
      group.add(door);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.4, 0.1, 0.12), trim);
      beam.position.set(0, spec.height * 0.58, -spec.depth / 2 - 0.06);
      group.add(beam);
    }
  } else {
    const parapetHeight = 0.42;
    for (const [x, z, w, d] of [
      [0, spec.depth / 2, spec.width + 0.5, 0.18],
      [0, -spec.depth / 2, spec.width + 0.5, 0.18],
      [spec.width / 2, 0, 0.18, spec.depth + 0.5],
      [-spec.width / 2, 0, 0.18, spec.depth + 0.5],
    ] as const) {
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(w, parapetHeight, d), roofMat);
      parapet.position.set(x, spec.height + 0.38, z);
      group.add(parapet);
    }
  }

  if (spec.style === 'office' || spec.style === 'tower') {
    const trimBand = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width + 0.55, 0.16, spec.depth + 0.55),
      trim,
    );
    trimBand.position.y = Math.max(3.4, spec.height * 0.82);
    group.add(trimBand);

    const entrance = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(spec.width * 0.38, 7), 3.1, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x1a2a32, roughness: 0.3, metalness: 0.5 }),
    );
    entrance.position.set(0, 1.55, -spec.depth / 2 - 0.45);
    group.add(entrance);
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(spec.width * 0.46, 9), 0.18, 2.2),
      trim,
    );
    canopy.position.set(0, 3.45, -spec.depth / 2 - 0.85);
    group.add(canopy);
  }

  if (spec.style === 'warehouse') {
    for (let i = -1; i <= 1; i += 1) {
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(4.6, 4.2, 0.1),
        standard(0x31383b, 0.55, 0.35),
      );
      door.position.set(i * 6, 2.1, -spec.depth / 2 - 0.06);
      group.add(door);
      if (Math.abs(i) === 1) {
        for (let stripe = 0; stripe < 5; stripe += 1) {
          const slat = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 0.03), trim);
          slat.position.set(i * 6, 0.7 + stripe * 0.75, -spec.depth / 2 - 0.12);
          group.add(slat);
        }
      }
    }
  }

  const rng = new Rng(spec.id.length * 811 + seedOffset);
  const units = spec.style === 'tower' ? 2 : 3;
  for (let i = 0; i < units; i += 1) {
    const w = rng.range(1.4, 3.2);
    const d = rng.range(1.2, 2.8);
    const h = rng.range(0.6, 1.4);
    const unit = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      standard(0x8d9293, 0.75, 0.25),
    );
    unit.position.set(
      rng.range(-spec.width * 0.33, spec.width * 0.33),
      spec.height + 0.3 + h / 2,
      rng.range(-spec.depth * 0.3, spec.depth * 0.3),
    );
    group.add(unit);
  }

  if (spec.style === 'tower') {
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 0.62, 3.2, spec.depth * 0.62),
      standard(0x636c72, 0.55, 0.35),
    );
    crown.position.y = spec.height + 1.8;
    group.add(crown);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 7, 6), standard(0x9da4a8, 0.4, 0.7));
    mast.position.y = spec.height + 6.9;
    group.add(mast);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff2a1e, emissive: 0xff2a1e, emissiveIntensity: 3 }),
    );
    beacon.position.y = spec.height + 10.4;
    group.add(beacon);
  }

  if (spec.style === 'office' || spec.style === 'tower') {
    const acUnit = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.8, 1.6),
      standard(0x767e82, 0.72, 0.3),
    );
    acUnit.position.set(-spec.width * 0.22, spec.height + 0.85, spec.depth * 0.14);
    group.add(acUnit);
  }

  shadowify(group);
  return group;
};

export const createTreeInstances = (trees: readonly TreeSpec[], theme: SceneTheme): THREE.Group => {
  const group = new THREE.Group();
  const broadleaf = trees.filter((tree) => tree.style === 'broadleaf');
  const pines = trees.filter((tree) => tree.style === 'pine');
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: theme.trunk, roughness: 0.95 });
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
  });

  const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.34, 1, 6);
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  trees.forEach((tree, i) => {
    const trunkHeight = tree.height * 0.48;
    matrix.compose(
      new THREE.Vector3(tree.x, trunkHeight / 2, tree.z),
      new THREE.Quaternion(),
      new THREE.Vector3(1, trunkHeight, 1),
    );
    trunkMesh.setMatrixAt(i, matrix);
  });
  group.add(trunkMesh);

  const leafGeometry = new THREE.IcosahedronGeometry(1, 1);
  const lower = new THREE.InstancedMesh(leafGeometry, leafMaterial, broadleaf.length);
  const upper = new THREE.InstancedMesh(leafGeometry, leafMaterial, broadleaf.length);
  broadleaf.forEach((tree, i) => {
    const color = new THREE.Color(theme.treeTints[tree.tint % theme.treeTints.length] ?? theme.treeTints[0]!);
    const lowerScale = new THREE.Vector3(tree.radius * 1.25, tree.radius * 0.82, tree.radius * 1.25);
    matrix.compose(
      new THREE.Vector3(tree.x, tree.height * 0.66, tree.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 1.7, 0)),
      lowerScale,
    );
    lower.setMatrixAt(i, matrix);
    lower.setColorAt(i, color);
    matrix.compose(
      new THREE.Vector3(tree.x + tree.radius * 0.18, tree.height * 0.9, tree.z - tree.radius * 0.12),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 2.1, 0)),
      new THREE.Vector3(tree.radius * 0.8, tree.radius * 0.65, tree.radius * 0.8),
    );
    upper.setMatrixAt(i, matrix);
    upper.setColorAt(i, color.clone().offsetHSL(0.01, 0.03, 0.05));
  });
  for (const mesh of [lower, upper]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceColor!.needsUpdate = true;
    group.add(mesh);
  }

  const pineGeometry = new THREE.ConeGeometry(1, 1, 7);
  const pineTiers = 3;
  for (let tier = 0; tier < pineTiers; tier += 1) {
    const mesh = new THREE.InstancedMesh(pineGeometry, leafMaterial, pines.length);
    pines.forEach((tree, i) => {
      const color = new THREE.Color(theme.treeTints[tree.tint % theme.treeTints.length] ?? theme.treeTints[0]!);
      const y = tree.height * (0.42 + tier * 0.2);
      const radius = tree.radius * (1.3 - tier * 0.3);
      const height = tree.height * 0.36;
      matrix.compose(
        new THREE.Vector3(tree.x, y, tree.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 1.3 + tier, 0)),
        new THREE.Vector3(radius, height, radius),
      );
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.clone().offsetHSL(0, 0.02, tier * 0.025));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceColor!.needsUpdate = true;
    group.add(mesh);
  }

  return group;
};

export const createProp = (prop: PropSpec): THREE.Group => {
  const group = new THREE.Group();
  group.position.set(prop.x, 0, prop.z);
  group.rotation.y = prop.rotation;
  group.scale.setScalar(prop.scale);
  const dark = standard(0x3b4144, 0.75, 0.35);
  const metal = standard(0x9aa1a4, 0.4, 0.7);
  switch (prop.kind) {
    case 'container': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.5), standard(0x8e5c40, 0.8, 0.25));
      box.position.y = 1.3;
      group.add(box);
      for (let i = -2; i <= 2; i += 1) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.45, 2.55), dark);
        rib.position.set(i * 1.2, 1.3, 0);
        group.add(rib);
      }
      break;
    }
    case 'tank': {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 5, 18), metal);
      tank.position.y = 2.5;
      group.add(tank);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(2.4, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), metal);
      cap.position.y = 5;
      group.add(cap);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.4, 6), dark);
      leg.position.y = 0.7;
      group.add(leg);
      break;
    }
    case 'silo': {
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 8, 16), metal);
      silo.position.y = 4;
      group.add(silo);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal);
      cap.position.y = 8;
      group.add(cap);
      break;
    }
    case 'antenna': {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.24, 16, 6), metal);
      mast.position.y = 8;
      group.add(mast);
      for (const y of [5, 9, 13]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 0.08), metal);
        arm.position.y = y;
        group.add(arm);
      }
      break;
    }
    case 'solar': {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(4.6, 0.08, 2.6),
        new THREE.MeshStandardMaterial({ color: 0x1c3348, roughness: 0.28, metalness: 0.55 }),
      );
      panel.position.y = 1.6;
      panel.rotation.x = -0.3;
      group.add(panel);
      for (const x of [-1.8, 1.8]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.5, 6), dark);
        post.position.set(x, 0.75, 0);
        group.add(post);
      }
      break;
    }
    case 'truck': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 5.4), standard(0x6f7b80, 0.7, 0.3));
      body.position.y = 1.8;
      group.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.6, 2.1), standard(0x8a4f35, 0.5, 0.35));
      cab.position.set(0, 1.3, -3.2);
      group.add(cab);
      break;
    }
  }
  shadowify(group);
  return group;
};

export const createTargetLabel = (spec: TargetScenarioSpec): THREE.Sprite => {
  const texture = makeLabelTexture(spec.label, 'VISUAL TRACK / GROUND', '#f2a65a');
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(10, 2.5, 1);
  sprite.position.y = 4.4;
  return sprite;
};
