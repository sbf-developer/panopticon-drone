import * as THREE from 'three';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import { vecToThree } from './math';

const lineMaterial = (color: number, opacity = 0.8): THREE.LineBasicMaterial =>
  new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });

export class FlightTrail {
  readonly line: THREE.Line;
  private readonly positions: Float32Array;
  private readonly maxPoints = 900;
  private count = 0;
  private lastSample = new THREE.Vector3(1e9, 0, 0);

  constructor() {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.maxPoints * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setDrawRange(0, 0);
    this.line = new THREE.Line(geometry, lineMaterial(0x6ee7ff, 0.5));
    this.line.frustumCulled = false;
  }

  reset(): void {
    this.count = 0;
    this.lastSample.set(1e9, 0, 0);
    this.line.geometry.setDrawRange(0, 0);
  }

  update(snapshot: SimulationSnapshot): void {
    const p = snapshot.drone.position;
    if (this.lastSample.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) < 0.9) return;
    this.lastSample.set(p.x, p.y, p.z);
    const index = this.count % this.maxPoints;
    this.positions[index * 3] = p.x;
    this.positions[index * 3 + 1] = p.y;
    this.positions[index * 3 + 2] = p.z;
    this.count += 1;
    this.line.geometry.setDrawRange(0, Math.min(this.count, this.maxPoints));
    const attribute = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
  }
}

export class PlannedPathLine {
  readonly line: THREE.Line;
  private readonly positions: Float32Array;
  private readonly maxPoints = 32;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.maxPoints * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setDrawRange(0, 0);
    this.line = new THREE.Line(geometry, lineMaterial(0x7ee787, 0.78));
    this.line.frustumCulled = false;
  }

  update(snapshot: SimulationSnapshot, visible: boolean): void {
    this.line.visible = visible;
    if (!visible) return;
    const points = snapshot.plannedPath;
    const count = Math.min(points.length, this.maxPoints);
    for (let i = 0; i < count; i += 1) {
      const point = points[i]!;
      this.positions[i * 3] = point.x;
      this.positions[i * 3 + 1] = point.y;
      this.positions[i * 3 + 2] = point.z;
    }
    this.line.geometry.setDrawRange(0, count);
    const attribute = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
  }
}

export class TargetGhost {
  readonly group = new THREE.Group();
  private readonly marker: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly beacon: THREE.Line;
  private readonly beaconPositions: Float32Array;

  constructor() {
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.75, 0),
      new THREE.MeshBasicMaterial({
        color: 0xf3a95c,
        wireframe: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    marker.position.y = 3.0;
    this.marker = marker;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.5, 2.72, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf3a95c,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    this.ring = ring;
    this.beaconPositions = new Float32Array(6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.beaconPositions, 3));
    this.beacon = new THREE.Line(geometry, lineMaterial(0xf3a95c, 0.55));
    this.group.add(marker, ring, this.beacon);
  }

  update(snapshot: SimulationSnapshot, visible: boolean): void {
    this.group.visible = visible && snapshot.perception.trackInitialized;
    if (!this.group.visible) return;
    const track = snapshot.perception.trackPosition;
    this.group.position.set(track.x, 0, track.z);
    const pulse = 1 + Math.sin(snapshot.time * 3.4) * 0.08;
    this.marker.scale.setScalar(pulse);
    this.ring.scale.setScalar(1 + Math.sin(snapshot.time * 2.1) * 0.12);
    this.beaconPositions.set([0, 0.1, 0, 0, 5.2, 0]);
    const attr = this.beacon.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }
}

export class StandoffRing {
  readonly mesh: THREE.Mesh;

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 72),
      new THREE.MeshBasicMaterial({
        color: 0x78dce8,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.09;
  }

  update(snapshot: SimulationSnapshot, visible: boolean): void {
    this.mesh.visible = visible && snapshot.perception.trackInitialized;
    if (!this.mesh.visible) return;
    this.mesh.position.set(
      snapshot.perception.trackPosition.x,
      0.09,
      snapshot.perception.trackPosition.z,
    );
    const radius = snapshot.mission.standoff;
    this.mesh.scale.setScalar(radius);
  }
}

export class ViewpointMarker {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly diamond: THREE.Mesh;
  private readonly pole: THREE.Line;
  private readonly polePositions = new Float32Array(6);

  constructor() {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.34, 32),
      new THREE.MeshBasicMaterial({
        color: 0x79e6ff,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42, 0),
      new THREE.MeshBasicMaterial({
        color: 0x79e6ff,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.polePositions, 3));
    this.pole = new THREE.Line(geometry, lineMaterial(0x79e6ff, 0.25));
    this.group.add(this.ring, this.diamond, this.pole);
  }

  update(snapshot: SimulationSnapshot, visible: boolean): void {
    const viewpoint = snapshot.mission.viewpoint;
    this.group.visible = visible && !!viewpoint;
    if (!this.group.visible || !viewpoint) return;
    this.group.position.set(viewpoint.x, viewpoint.y, viewpoint.z);
    this.diamond.position.y = 0;
    this.ring.position.y = -viewpoint.y + 0.1;
    this.polePositions.set([0, 0, 0, 0, -viewpoint.y + 0.1, 0]);
    const attr = this.pole.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }
}

export class SensorFrustum {
  readonly line: THREE.LineSegments;
  private readonly positions = new Float32Array(16 * 3);

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setDrawRange(0, 16);
    this.line = new THREE.LineSegments(geometry, lineMaterial(0x7fe3f2, 0.24));
    this.line.frustumCulled = false;
  }

  update(snapshot: SimulationSnapshot, visible: boolean): void {
    this.line.visible = visible;
    if (!visible) return;
    const gimbal = snapshot.perception.gimbal;
    const origin = vecToThree(gimbal.position);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      new THREE.Quaternion(gimbal.orientation.x, gimbal.orientation.y, gimbal.orientation.z, gimbal.orientation.w),
    );
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      new THREE.Quaternion(gimbal.orientation.x, gimbal.orientation.y, gimbal.orientation.z, gimbal.orientation.w),
    );
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
      new THREE.Quaternion(gimbal.orientation.x, gimbal.orientation.y, gimbal.orientation.z, gimbal.orientation.w),
    );
    const distance = 55;
    const halfH = Math.tan(gimbal.fovHorizontal / 2) * distance;
    const halfV = Math.tan(gimbal.fovVertical / 2) * distance;
    const center = origin.clone().addScaledVector(forward, distance);
    const corners = [
      center.clone().addScaledVector(right, -halfH).addScaledVector(up, -halfV),
      center.clone().addScaledVector(right, halfH).addScaledVector(up, -halfV),
      center.clone().addScaledVector(right, halfH).addScaledVector(up, halfV),
      center.clone().addScaledVector(right, -halfH).addScaledVector(up, halfV),
    ];
    const segments: THREE.Vector3[] = [];
    for (const corner of corners) segments.push(origin, corner);
    for (let i = 0; i < 4; i += 1) segments.push(corners[i]!, corners[(i + 1) % 4]!);
    segments.forEach((point, i) => {
      this.positions[i * 3] = point.x;
      this.positions[i * 3 + 1] = point.y;
      this.positions[i * 3 + 2] = point.z;
    });
    const attribute = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
  }
}

export class LaserLine {
  readonly line: THREE.Line;
  private readonly positions = new Float32Array(6);

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.line = new THREE.Line(geometry, lineMaterial(0xffc46b, 0.5));
    this.line.frustumCulled = false;
  }

  update(snapshot: SimulationSnapshot, visible: boolean): void {
    this.line.visible = visible && snapshot.perception.detection.visible;
    if (!this.line.visible) return;
    const g = snapshot.perception.gimbal.position;
    const t = snapshot.perception.trackPosition;
    this.positions.set([g.x, g.y, g.z, t.x, t.y + 1.1, t.z]);
    const attr = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }
}

export class DroneHalo {
  readonly group = new THREE.Group();
  private readonly ring: THREE.LineLoop;
  private readonly ticks: THREE.LineSegments;
  private readonly tickPositions = new Float32Array(4 * 2 * 3);

  constructor() {
    const radius = 1.55;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 64; i += 1) {
      const angle = (i / 64) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    }
    const ringGeometry = new THREE.BufferGeometry().setFromPoints(points);
    this.ring = new THREE.LineLoop(ringGeometry, lineMaterial(0x6fe3f2, 0.42));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.tickPositions, 3));
    this.ticks = new THREE.LineSegments(geometry, lineMaterial(0x6fe3f2, 0.55));
    this.group.add(this.ring, this.ticks);
  }

  update(snapshot: SimulationSnapshot, visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    const p = snapshot.drone.position;
    this.group.position.set(p.x, p.y, p.z);
    const radius = 1.55;
    const inner = 1.82;
    this.tickPositions.set([
      radius, 0, 0, inner, 0, 0,
      -radius, 0, 0, -inner, 0, 0,
      0, 0, radius, 0, 0, inner,
      0, 0, -radius, 0, 0, -inner,
    ]);
    const attr = this.ticks.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }
}
