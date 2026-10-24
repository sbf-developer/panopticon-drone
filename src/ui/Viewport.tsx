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
  { mode: 'ORBIT', label: 'Orbit camera', icon: Orbit },
  { mode: 'CHASE', label: 'Chase camera', icon: Camera },
  { mode: 'TOP', label: 'Map camera', icon: Map },
  { mode: 'GIMBAL', label: 'Gimbal camera', icon: Video },
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
  const phaseClass = snapshot.mission.phase === 'FAILED' ? 'is-bad' : snapshot.mission.phase === 'LOST' ? 'is-warn' : 'is-good';
  const detection = snapshot.perception.detection;

  const toggle = (key: keyof DebugOptions): void => {
    onDebug({ ...debug, [key]: !debug[key] });
  };

  return (
    <div className="viewport">
      <div className={`viewport__stage ${snapshot.mission.phase === 'FAILED' ? 'is-failed' : ''}`} ref={stageRef} />
      <div className="viewport__vignette" />
      <div className="viewport__scanlines" />

      <div className="viewport__info">
        <span className="viewport__live"><i /> Live simulation</span>
        <strong>{scenario.name}</strong>
        <small>{scenario.code} / {formatNumber(snapshot.drone.altitude, 0)} m / {formatNumber(stats.fps, 0)} fps</small>
      </div>

      <div className={`phase-pill ${phaseClass}`}>
        <i />
        <span>{snapshot.mission.phase}</span>
        <em>{snapshot.perception.trackStatus}</em>
      </div>

      <div className="camera-modes" role="group" aria-label="Camera mode">
        {MODES.map(({ mode, label, icon: Icon }) => (
          <button
            type="button"
            key={mode}
            className={cameraMode === mode ? 'is-active' : ''}
            onClick={() => onCameraMode(mode)}
            title={label}
            aria-label={label}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      <div className="viewport__hud">
        <div className="debug-chips">
          <button type="button" className={debug.plan ? 'is-on' : ''} onClick={() => toggle('plan')} title="Planned path">
            <Route size={14} />
          </button>
          <button type="button" className={debug.track ? 'is-on' : ''} onClick={() => toggle('track')} title="Target estimate">
            <Crosshair size={14} />
          </button>
          <button type="button" className={debug.sensor ? 'is-on' : ''} onClick={() => toggle('sensor')} title="Sensor field of view">
            <ScanLine size={14} />
          </button>
          <button type="button" className={debug.labels ? 'is-on' : ''} onClick={() => toggle('labels')} title="Labels">
            <Layers size={14} />
          </button>
        </div>
        <div className="hud-readouts">
          <div><span>HDG</span><strong>{formatCompass(snapshot.drone.heading)}</strong></div>
          <div><span>ALT</span><strong>{formatNumber(snapshot.drone.agl, 0)}<em>m</em></strong></div>
          <div><span>WIND</span><strong>{formatNumber(snapshot.wind.speed, 1)}<em>m/s</em></strong></div>
        </div>
      </div>

      <div className="fpv">
        <div className="fpv__header">
          <div className="fpv__title">
            <Video size={14} />
            <span>EO feed</span>
            <em>CH-01</em>
          </div>
          <div className="fpv__status">
            <i className={`fpv__dot fpv__dot--${tone}`} />
            <span>{snapshot.perception.trackStatus.toLowerCase()}</span>
          </div>
        </div>
        <div className="fpv__screen">
          <canvas ref={feedRef} className="fpv__feed" />
          <canvas ref={overlayRef} className="fpv__overlay" />
        </div>
        <div className="fpv__footer">
          <span>1280 x 720 / 30 Hz</span>
          <span>{detection.visible ? `${formatNumber(detection.range, 0)} m` : detection.occluded ? 'LOS blocked' : 'No contact'}</span>
          <span>{formatCompass((snapshot.perception.targetBearing * 180) / Math.PI)}</span>
        </div>
      </div>

      <div className="viewport__tag">
        <span>Simulation</span>
        <span>{stats.paused ? 'Hold' : `${stats.speed}x`}</span>
      </div>
    </div>
  );
};
