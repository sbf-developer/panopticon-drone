import * as THREE from 'three';
import type { ScenarioDefinition } from '../core/world/types';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import { buildEnvironment } from './world';
import { DroneModel, TargetModel, createTargetLabel } from './models';
import { quatToThree } from './math';
import {
  DroneHalo,
  FlightTrail,
  LaserLine,
  PlannedPathLine,
  SensorFrustum,
  StandoffRing,
  TargetGhost,
  ViewpointMarker,
} from './visualizers';

export type CameraMode = 'ORBIT' | 'CHASE' | 'TOP' | 'GIMBAL';

export interface DebugOptions {
  plan: boolean;
  track: boolean;
  sensor: boolean;
  labels: boolean;
}

const DEFAULT_DEBUG: DebugOptions = {
  plan: true,
  track: true,
  sensor: false,
  labels: true,
};

interface CameraTarget {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export class SimulationView {
  private scenario: ScenarioDefinition;
  private container: HTMLElement | null = null;
  private mainCanvas: HTMLCanvasElement | null = null;
  private feedCanvas: HTMLCanvasElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private feedRenderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private readonly mainCamera = new THREE.PerspectiveCamera(47, 1, 0.4, 4200);
  private readonly feedCamera = new THREE.PerspectiveCamera(22, 16 / 9, 0.08, 4200);
  private drone: DroneModel | null = null;
  private target: TargetModel | null = null;
  private targetLabel: THREE.Sprite | null = null;
  private trail: FlightTrail = new FlightTrail();
  private plannedPath: PlannedPathLine = new PlannedPathLine();
  private targetGhost: TargetGhost = new TargetGhost();
  private standoffRing: StandoffRing = new StandoffRing();
  private viewpoint: ViewpointMarker = new ViewpointMarker();
  private frustum: SensorFrustum = new SensorFrustum();
  private laser: LaserLine = new LaserLine();
  private halo = new DroneHalo();
  private resizeObserver: ResizeObserver | null = null;
  private feedWidth = 1;
  private feedHeight = 1;
  private cameraMode: CameraMode = 'ORBIT';
  private debug: DebugOptions = { ...DEFAULT_DEBUG };
  private elapsed = 0;
  private cameraState: CameraTarget = {
    position: new THREE.Vector3(50, 45, 55),
    target: new THREE.Vector3(0, 20, 0),
  };
  private feedAccumulator = 0;
  private lastSnapshot: SimulationSnapshot | null = null;

  constructor(scenario: ScenarioDefinition) {
    this.scenario = scenario;
    this.mainCamera.up.set(0, 1, 0);
    this.mainCamera.layers.enable(2);
  }

  attach(container: HTMLElement, feedCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement): void {
    if (this.container && this.container !== container) this.detach();
    this.container = container;
    this.feedCanvas = feedCanvas;
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext('2d');

    if (!this.renderer) {
      this.mainCanvas = document.createElement('canvas');
      this.mainCanvas.className = 'sim-canvas';
      container.appendChild(this.mainCanvas);
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.mainCanvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

      this.feedRenderer = new THREE.WebGLRenderer({
        canvas: feedCanvas,
        antialias: false,
        alpha: false,
        powerPreference: 'low-power',
      });
      this.feedRenderer.outputColorSpace = THREE.SRGBColorSpace;
      this.feedRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.feedRenderer.shadowMap.enabled = false;
      this.feedRenderer.setPixelRatio(1);
    } else if (this.mainCanvas && this.mainCanvas.parentElement !== container) {
      container.appendChild(this.mainCanvas);
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    if (feedCanvas.parentElement) this.resizeObserver.observe(feedCanvas.parentElement);
    if (!this.scene) this.buildScene();
    this.resize();
  }

  detach(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.mainCanvas?.parentElement) this.mainCanvas.parentElement.removeChild(this.mainCanvas);
    this.disposeScene();
    this.renderer?.dispose();
    this.feedRenderer?.dispose();
    this.renderer = null;
    this.feedRenderer = null;
    this.mainCanvas = null;
    this.container = null;
    this.feedCanvas = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;
  }

  setScenario(scenario: ScenarioDefinition): void {
    this.scenario = scenario;
    if (this.renderer) {
      this.disposeScene();
      this.buildScene();
      this.resize();
    }
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  setDebug(options: Partial<DebugOptions>): void {
    this.debug = { ...this.debug, ...options };
  }

  resetTrail(): void {
    this.trail.reset();
  }

  update(snapshot: SimulationSnapshot, dt: number): void {
    this.elapsed += dt;
    this.lastSnapshot = snapshot;
    if (!this.scene) return;
    this.drone?.update(snapshot, dt);
    this.target?.update(snapshot, dt);
    this.trail.update(snapshot);
    this.plannedPath.update(snapshot, this.debug.plan);
    this.targetGhost.update(snapshot, this.debug.track);
    this.standoffRing.update(snapshot, this.debug.track);
    this.viewpoint.update(snapshot, this.debug.track);
    this.frustum.update(snapshot, this.debug.sensor);
    this.laser.update(snapshot, this.debug.sensor);
    this.halo.update(snapshot, this.debug.labels);
    if (this.targetLabel) this.targetLabel.visible = this.debug.labels;
    this.updateCameras(snapshot, dt);
  }

  render(dt: number): void {
    if (!this.renderer || !this.feedRenderer || !this.scene) return;
    this.renderer.render(this.scene, this.mainCamera);
    this.feedAccumulator += dt;
    if (this.feedAccumulator >= 1 / 30) {
      this.feedAccumulator = 0;
      const gimbal = this.lastSnapshot?.perception.gimbal;
      if (gimbal && this.feedCanvas) {
        this.feedCamera.position.set(gimbal.position.x, gimbal.position.y, gimbal.position.z);
        this.feedCamera.quaternion.copy(quatToThree(gimbal.orientation));
        this.feedCamera.fov = (gimbal.fovVertical * 180) / Math.PI;
        const aspect = this.feedWidth / Math.max(1, this.feedHeight);
        if (Math.abs(this.feedCamera.aspect - aspect) > 1e-4) {
          this.feedCamera.aspect = aspect;
        }
        this.feedCamera.updateProjectionMatrix();
      }
      this.feedRenderer.render(this.scene, this.feedCamera);
      this.drawOverlay();
    }
  }

  private buildScene(): void {
    if (!this.renderer) return;
    const environment = buildEnvironment(this.scenario, this.renderer);
    this.scene = environment.scene;
    this.renderer.toneMappingExposure = this.scenario.theme.exposure;
    if (this.feedRenderer) this.feedRenderer.toneMappingExposure = this.scenario.theme.exposure * 1.04;

    this.trail = new FlightTrail();
    this.plannedPath = new PlannedPathLine();
    this.targetGhost = new TargetGhost();
    this.standoffRing = new StandoffRing();
    this.viewpoint = new ViewpointMarker();
    this.frustum = new SensorFrustum();
    this.laser = new LaserLine();
    this.halo = new DroneHalo();

    this.drone = new DroneModel();
    this.drone.root.traverse((object) => object.layers.set(2));
    this.target = new TargetModel(this.scenario.target);
    this.targetLabel = createTargetLabel(this.scenario.target);
    this.targetLabel.layers.set(2);
    this.target.root.add(this.targetLabel);
    this.scene.add(this.drone.root, this.target.root);
    this.scene.add(this.trail.line, this.plannedPath.line, this.targetGhost.group, this.standoffRing.mesh);
    this.scene.add(this.viewpoint.group, this.frustum.line, this.laser.line, this.halo.group);
    for (const object of [
      this.trail.line,
      this.plannedPath.line,
      this.targetGhost.group,
      this.standoffRing.mesh,
      this.viewpoint.group,
      this.frustum.line,
      this.laser.line,
      this.halo.group,
    ]) {
      object.traverse((child) => child.layers.set(2));
    }

    this.trail.reset();
    const home = new THREE.Vector3(
      this.scenario.drone.home.x,
      this.scenario.drone.cruiseAltitude * 0.5 + 12,
      this.scenario.drone.home.z + 42,
    );
    this.cameraState.position.copy(home);
    this.cameraState.target.set(this.scenario.drone.home.x, 15, this.scenario.drone.home.z);
    this.mainCamera.position.copy(home);
    this.mainCamera.lookAt(this.cameraState.target);
    this.feedCamera.fov = 22;
    this.feedCamera.updateProjectionMatrix();
  }

  private disposeScene(): void {
    if (this.scene) {
      this.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
        const geometry = object.geometry;
        geometry?.dispose();
        const material = object.material;
        const materials = Array.isArray(material) ? material : [material];
        for (const item of materials) {
          if (!item) continue;
          for (const value of Object.values(item)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          item.dispose();
        }
      });
    }
    this.scene = null;
    this.drone = null;
    this.target = null;
    this.targetLabel = null;
    this.targetGhost.group.removeFromParent();
    this.standoffRing.mesh.removeFromParent();
    this.viewpoint.group.removeFromParent();
    this.frustum.line.removeFromParent();
    this.laser.line.removeFromParent();
    this.plannedPath.line.removeFromParent();
    this.trail.line.removeFromParent();
    this.halo.group.removeFromParent();
  }

  private resize(): void {
    if (!this.container) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    if (this.renderer) {
      this.renderer.setSize(width, height, false);
      this.mainCamera.aspect = width / height;
      this.mainCamera.updateProjectionMatrix();
    }
    if (this.feedCanvas) {
      const rect = this.feedCanvas.getBoundingClientRect();
      this.feedWidth = Math.max(2, Math.round(rect.width));
      this.feedHeight = Math.max(2, Math.round(rect.height));
      if (this.feedRenderer) this.feedRenderer.setSize(this.feedWidth, this.feedHeight, false);
      this.feedCamera.aspect = this.feedWidth / this.feedHeight;
      this.feedCamera.updateProjectionMatrix();
    }
    if (this.overlayCanvas) {
      const rect = this.overlayCanvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.overlayCanvas.width = Math.max(2, Math.floor(rect.width * dpr));
      this.overlayCanvas.height = Math.max(2, Math.floor(rect.height * dpr));
      if (this.overlayCtx) this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  private updateCameras(snapshot: SimulationSnapshot, dt: number): void {
    if (!this.scene) return;
    const drone = new THREE.Vector3(
      snapshot.drone.position.x,
      snapshot.drone.position.y,
      snapshot.drone.position.z,
    );
    const target = new THREE.Vector3(
      snapshot.targetTruth.position.x,
      snapshot.targetTruth.position.y + 1.3,
      snapshot.targetTruth.position.z,
    );
    const toTarget = target.clone().sub(drone);
    const targetDirection = toTarget.lengthSq() > 1 ? toTarget.clone().normalize() : new THREE.Vector3(0, 0, -1);

    if (this.cameraMode === 'GIMBAL') {
      const gimbal = snapshot.perception.gimbal;
      this.mainCamera.position.set(gimbal.position.x, gimbal.position.y, gimbal.position.z);
      this.mainCamera.quaternion.copy(quatToThree(gimbal.orientation));
      this.mainCamera.fov = 38;
      this.mainCamera.updateProjectionMatrix();
      return;
    }

    let desiredPosition: THREE.Vector3;
    let desiredTarget: THREE.Vector3;
    this.mainCamera.fov = this.cameraMode === 'TOP' ? 42 : this.cameraMode === 'CHASE' ? 52 : 47;
    this.mainCamera.updateProjectionMatrix();
    if (this.cameraMode === 'TOP') {
      desiredPosition = drone.clone().add(new THREE.Vector3(0.01, 118, 0.01));
      desiredTarget = drone.clone();
      this.mainCamera.up.set(0, 0, -1);
    } else if (this.cameraMode === 'CHASE') {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
        quatToThree(snapshot.drone.orientation),
      );
      forward.y = 0;
      if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
      forward.normalize();
      if (forward.dot(new THREE.Vector3(targetDirection.x, 0, targetDirection.z).normalize()) < -0.5) {
        forward.set(targetDirection.x, 0, targetDirection.z).normalize();
      }
      desiredPosition = drone
        .clone()
        .addScaledVector(forward, -30)
        .add(new THREE.Vector3(0, 11, 0));
      desiredTarget = drone.clone().addScaledVector(targetDirection, 10).add(new THREE.Vector3(0, -4, 0));
      this.mainCamera.up.set(0, 1, 0);
    } else {
      const away = drone.clone().sub(target);
      if (away.lengthSq() < 1) away.set(0, 0, 1);
      const baseAngle = Math.atan2(away.x, away.z);
      const angle = baseAngle + Math.sin(this.elapsed * 0.1) * 0.34;
      const center = drone.clone().lerp(target, 0.34);
      const radius = 34 + drone.distanceTo(target) * 0.34;
      desiredPosition = center
        .clone()
        .add(new THREE.Vector3(Math.sin(angle) * radius, 12, Math.cos(angle) * radius));
      desiredTarget = center.clone().add(new THREE.Vector3(0, 1, 0));
      this.mainCamera.up.set(0, 1, 0);
    }
    if (desiredPosition.y < 3) desiredPosition.y = 3;
    const smoothing = this.cameraMode === 'CHASE' ? 3.2 : 2.2;
    const alpha = 1 - Math.exp(-dt * smoothing);
    this.cameraState.position.lerp(desiredPosition, Math.min(1, alpha));
    this.cameraState.target.lerp(desiredTarget, Math.min(1, alpha * 1.4));
    this.mainCamera.position.copy(this.cameraState.position);
    this.mainCamera.lookAt(this.cameraState.target);
  }

  private drawOverlay(): void {
    const ctx = this.overlayCtx;
    const canvas = this.overlayCanvas;
    const snapshot = this.lastSnapshot;
    if (!ctx || !canvas || !snapshot) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.clearRect(0, 0, width, height);
    ctx.save();

    ctx.strokeStyle = 'rgba(232, 240, 242, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 12, height / 2);
    ctx.lineTo(width / 2 - 5, height / 2);
    ctx.moveTo(width / 2 + 5, height / 2);
    ctx.lineTo(width / 2 + 12, height / 2);
    ctx.moveTo(width / 2, height / 2 - 12);
    ctx.lineTo(width / 2, height / 2 - 5);
    ctx.moveTo(width / 2, height / 2 + 5);
    ctx.lineTo(width / 2, height / 2 + 12);
    ctx.stroke();

    const status = snapshot.perception.trackStatus;
    const color =
      status === 'TRACKING'
        ? '#9be7bd'
        : status === 'COASTING' || status === 'ACQUIRING'
          ? '#f6c97a'
          : '#ff8c7f';
    const detection = snapshot.perception.detection;
    const projected = detection.visible
      ? projectPoint(
          this.feedCamera,
          snapshot.targetTruth.position.x,
          snapshot.targetTruth.position.y + 1.4,
          snapshot.targetTruth.position.z,
          width,
          height,
        )
      : null;
    if (projected) {
      const distance = Math.max(4, snapshot.perception.detection.range);
      const boxHeight = THREE.MathUtils.clamp(
        (3.2 / (2 * distance * Math.tan(this.feedCamera.fov / 2))) * height,
        24,
        130,
      );
      const boxWidth = boxHeight * 1.35;
      const x = projected.x - boxWidth / 2;
      const y = projected.y - boxHeight / 2;
      const arm = Math.min(boxWidth, boxHeight) * 0.22;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      drawBracket(ctx, x, y, boxWidth, boxHeight, arm);
      ctx.fillStyle = color;
      ctx.font = '600 9px "Space Grotesk", sans-serif';
      ctx.fillText(status === 'TRACKING' ? 'Lock' : 'Coast', x, y - 7);
      ctx.fillStyle = 'rgba(235, 242, 243, 0.8)';
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.fillText(`${distance.toFixed(0)} m`, x + boxWidth - 26, y + boxHeight + 13);
    } else {
      ctx.fillStyle = detection.occluded ? '#f6c97a' : 'rgba(216, 229, 232, 0.65)';
      ctx.font = '500 10px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        detection.occluded ? 'Line of sight blocked' : 'Searching',
        width / 2,
        height / 2 + 34,
      );
      ctx.textAlign = 'left';
    }

    if (snapshot.drone.crashed) {
      ctx.fillStyle = 'rgba(180, 30, 20, 0.16)';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#ff6b56';
      ctx.lineWidth = 2;
      ctx.font = '700 14px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffb4a8';
      ctx.fillText('AIRFRAME FAILURE', 16, height - 48);
    }
    ctx.restore();
  }
}

const projectPoint = (
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): { x: number; y: number } | null => {
  const point = new THREE.Vector3(x, y, z).project(camera);
  if (point.z < -1 || point.z > 1) return null;
  return {
    x: (point.x * 0.5 + 0.5) * width,
    y: (-point.y * 0.5 + 0.5) * height,
  };
};

const drawBracket = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  arm: number,
): void => {
  ctx.beginPath();
  ctx.moveTo(x, y + arm);
  ctx.lineTo(x, y);
  ctx.lineTo(x + arm, y);
  ctx.moveTo(x + width - arm, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + arm);
  ctx.moveTo(x + width, y + height - arm);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width - arm, y + height);
  ctx.moveTo(x + arm, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + height - arm);
  ctx.stroke();
};
