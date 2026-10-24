import { useEffect, useRef } from 'react';
import {
  Camera,
  Crosshair,
  Layers,
  Map,
  Orbit,
  Route,
  ScanLine,
  Video,
} from 'lucide-react';
import type { SimulationRuntime, RuntimeStats } from '../app/SimulationRuntime';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import type { ScenarioDefinition } from '../core/world/types';
import type { CameraMode, DebugOptions } from '../render/SimulationView';
import { formatCompass, formatNumber, statusTone } from './format';

type ModeButton = { mode: CameraMode; label: string; icon: typeof Orbit };

const MODES: ModeButton[] = [
  { mode: 'ORBIT', label: 'ORBIT', icon: Orbit },
  { mode: 'CHASE', label: 'CHASE', icon: Camera },
  { mode: 'TOP', label: 'MAP', icon: Map },
  { mode: 'GIMBAL', label: 'GIMBAL', icon: Video },
];

interface ViewportProps {
  runtime: SimulationRuntime | null;
  snapshot: SimulationSnapshot;
  stats: RuntimeStats;
  scenario: ScenarioDefinition;
  cameraMode: CameraMode;
  onCameraMode: (mode: CameraMode) => void;
  debug: DebugOptions;
  onDebug: (next: DebugOptions) => void;
}

export const Viewport = ({
  runtime,
  snapshot,
  stats,
  scenario,
  cameraMode,
  onCameraMode,
  debug,
  onDebug,
}: ViewportProps) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!runtime || !stageRef.current || !feedRef.current || !overlayRef.current) return;
    runtime.attach(stageRef.current, feedRef.current, overlayRef.current);
    return () => runtime.detach();
  }, [runtime]);

  useEffect(() => {
    runtime?.setCameraMode(cameraMode);
  }, [runtime, cameraMode]);

  useEffect(() => {
    runtime?.setDebug(debug);
  }, [runtime, debug]);

  const tone = statusTone(snapshot.perception.trackStatus);
  const phase = snapshot.mission.phase;
  const phaseClass = phase === 'FAILED' ? 'is-bad' : phase === 'LOST' ? 'is-warn' : 'is-good';
  const detection = snapshot.perception.detection;

  const toggle = (key: keyof DebugOptions): void => {
    onDebug({ ...debug, [key]: !debug[key] });
  };

  return (
    <div className="viewport">
      <div className={`viewport__stage ${phase === 'FAILED' ? 'is-failed' : ''}`} ref={stageRef} />

      <div className="viewport__vignette" />
      <div className="viewport__scanlines" />

      <div className="viewport__top-left">
        <div className="scene-badge">
          <span className="scene-badge__live"><i /> LIVE SIMULATION</span>
          <strong>{scenario.code} / {scenario.name.toUpperCase()}</strong>
          <span className="mono">41.7021° N · 87.6312° W · +{formatNumber(snapshot.drone.altitude, 0)} M</span>
        </div>
      </div>

      <div className={`viewport__phase ${phaseClass}`}>
        <span className="micro-label">FLIGHT PHASE</span>
        <strong>{phase}</strong>
        <span className={`chip chip--${tone}`}>{snapshot.perception.trackStatus}</span>
      </div>

      <div className="viewport__top-right">
        <div className="camera-modes" role="group" aria-label="Camera mode">
          {MODES.map(({ mode, label, icon: Icon }) => (
            <button
              type="button"
              key={mode}
              className={cameraMode === mode ? 'is-active' : ''}
              onClick={() => onCameraMode(mode)}
              title={`${label} camera`}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="viewport__heading">
        <div className="heading-readout">
          <span className="micro-label">HDG</span>
          <strong>{formatCompass(snapshot.drone.heading)}</strong>
        </div>
        <div className="heading-tape">
          {[-3, -2, -1, 0, 1, 2, 3].map((offset) => {
            const value = (snapshot.drone.heading + offset * 15 + 360) % 360;
            return (
              <span key={offset} className={offset === 0 ? 'is-center' : ''}>
                {String(Math.round(value / 10) * 10).padStart(3, '0')}
              </span>
            );
          })}
          <i className="heading-tape__cursor" />
        </div>
        <div className="heading-readout heading-readout--right">
          <span className="micro-label">WIND</span>
          <strong>{formatNumber(snapshot.wind.speed, 1)}<em>m/s</em></strong>
        </div>
      </div>

      <div className="viewport__bottom-left">
        <div className="debug-chips">
          <button type="button" className={debug.plan ? 'is-on' : ''} onClick={() => toggle('plan')}>
            <Route size={12} /> PLAN
          </button>
          <button type="button" className={debug.track ? 'is-on' : ''} onClick={() => toggle('track')}>
            <Crosshair size={12} /> TRACK
          </button>
          <button type="button" className={debug.sensor ? 'is-on' : ''} onClick={() => toggle('sensor')}>
            <ScanLine size={12} /> SENSOR
          </button>
          <button type="button" className={debug.labels ? 'is-on' : ''} onClick={() => toggle('labels')}>
            <Layers size={12} /> LABELS
          </button>
        </div>
        <div className="coordinate-strip">
          <span className="micro-label">POSITION / LOCAL ENU</span>
          <strong className="mono">
            {snapshot.drone.position.x >= 0 ? 'E' : 'W'} {Math.abs(snapshot.drone.position.x).toFixed(1)} ·
            {' '}{snapshot.drone.position.z >= 0 ? 'S' : 'N'} {Math.abs(snapshot.drone.position.z).toFixed(1)}
          </strong>
          <span className="mono subtle-text">AGL {snapshot.drone.agl.toFixed(1)} M</span>
        </div>
      </div>

      <div className="fpv">
        <div className="fpv__header">
          <div className="fpv__title">
            <Video size={13} />
            <span>EO / GIMBAL</span>
            <em>CH 01</em>
          </div>
          <div className="fpv__status">
            <i className={`fpv__dot fpv__dot--${tone}`} />
            <span>{snapshot.perception.trackStatus}</span>
          </div>
        </div>
        <div className="fpv__screen">
          <canvas ref={feedRef} className="fpv__feed" />
          <canvas ref={overlayRef} className="fpv__overlay" />
        </div>
        <div className="fpv__footer">
          <span>1280 × 720 · 30 HZ</span>
          <span>{detection.visible ? `RNG ${formatNumber(detection.range, 0)} M` : detection.occluded ? 'LOS BLOCKED' : 'NO CONTACT'}</span>
          <span className="mono">{formatCompass(snapshot.perception.targetBearing * 180 / Math.PI)}</span>
        </div>
      </div>

      <div className="viewport__footnote">
        <span>SIMULATION / NOT FLIGHT DATA</span>
        <span className="mono">{stats.paused ? 'PAUSED' : `${stats.speed.toFixed(1)}× · ${formatNumber(stats.fps, 0)} FPS`}</span>
      </div>
    </div>
  );
};
