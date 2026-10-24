import { Gauge, Map, SlidersHorizontal } from 'lucide-react';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import type { RuntimeStats } from '../app/SimulationRuntime';
import type { ScenarioDefinition } from '../core/world/types';
import type { FollowBehavior } from '../core/sim/mission';
import { Panel, Bar, StatusDot } from './components/Panel';
import { AttitudeIndicator } from './components/AttitudeIndicator';
import { MiniMap } from './components/MiniMap';
import { formatCompass, formatNumber } from './format';

interface TelemetryRailProps {
  snapshot: SimulationSnapshot;
  stats: RuntimeStats;
  scenario: ScenarioDefinition;
  behavior: FollowBehavior;
  standoff: number;
  windSpeed: number;
  onBehavior: (behavior: FollowBehavior) => void;
  onStandoff: (value: number) => void;
  onWind: (value: number) => void;
}

export const TelemetryRail = ({
  snapshot,
  stats,
  scenario,
  behavior,
  standoff,
  windSpeed,
  onBehavior,
  onStandoff,
  onWind,
}: TelemetryRailProps) => {
  const drone = snapshot.drone;
  const batteryTone = drone.batteryPercent < 15 ? 'orange' : drone.batteryPercent < 30 ? 'amber' : 'green';
  const link = Math.max(0.18, 1 - snapshot.sensors.positionSigma / 3.2);
  const plannerTone =
    snapshot.planner.status === 'EMERGENCY' || snapshot.planner.status === 'BLOCKED'
      ? 'bad'
      : snapshot.planner.status === 'AVOIDING'
        ? 'warn'
        : 'good';

  return (
    <aside className="rail rail--right">
      <Panel
        title="Flight"
        eyebrow="Telemetry and attitude"
        icon={Gauge}
        action={<span className="fps">{formatNumber(stats.fps, 0)} fps</span>}
      >
        <div className="flight-hero">
          <div>
            <span>Altitude</span>
            <strong>{formatNumber(drone.altitude, 1)}<em>m</em></strong>
            <small>AGL {formatNumber(drone.agl, 1)} m</small>
          </div>
          <div>
            <span>Ground speed</span>
            <strong>{formatNumber(drone.horizontalSpeed, 1)}<em>m/s</em></strong>
            <small>V/S {drone.verticalSpeed >= 0 ? '+' : ''}{formatNumber(drone.verticalSpeed, 1)}</small>
          </div>
        </div>

        <AttitudeIndicator snapshot={snapshot} />

        <div className="flight-stats">
          <div><span>Heading</span><strong>{formatCompass(drone.heading)}</strong></div>
          <div><span>Throttle</span><strong>{(drone.throttle * 100).toFixed(0)}%</strong></div>
          <div><span>Battery</span><strong>{drone.batteryPercent.toFixed(0)}%</strong></div>
          <div><span>Link</span><strong>{(link * 100).toFixed(0)}%</strong></div>
        </div>

        <div className="battery-row">
          <div>
            <span>6S / 5000 mAh</span>
            <span>{formatNumber(drone.voltage, 1)} V / {formatNumber(drone.current, 1)} A</span>
          </div>
          <Bar value={drone.batteryPercent / 100} tone={batteryTone} />
        </div>

        <div className="system-inline">
          <span><StatusDot tone={snapshot.sensors.satellites > 10 ? 'good' : 'warn'} />GNSS {snapshot.sensors.satellites}</span>
          <span><StatusDot tone="neutral" />Wind {formatNumber(snapshot.wind.speed, 1)}</span>
          <span><StatusDot tone={plannerTone} />{snapshot.planner.status}</span>
        </div>
      </Panel>

      <Panel title="Map" eyebrow={`${scenario.code} / local grid`} icon={Map} className="map-panel">
        <MiniMap scenario={scenario} snapshot={snapshot} />
        <div className="map-legend">
          <span><i className="legend-dot legend-dot--uav" /> Drone</span>
          <span><i className="legend-dot legend-dot--tgt" /> Subject</span>
          <span><i className="legend-dot legend-dot--home" /> Home</span>
          <span>N</span>
        </div>
      </Panel>

      <Panel title="Autonomy" eyebrow="Operator parameters" icon={SlidersHorizontal}>
        <div className="control-block">
          <div className="control-label">
            <span>Follow behaviour</span>
            <span>{behavior === 'PURSUIT' ? 'Pursuit' : 'Overwatch'}</span>
          </div>
          <div className="segmented">
            <button type="button" className={behavior === 'PURSUIT' ? 'is-active' : ''} onClick={() => onBehavior('PURSUIT')}>Pursuit</button>
            <button type="button" className={behavior === 'OVERWATCH' ? 'is-active' : ''} onClick={() => onBehavior('OVERWATCH')}>Overwatch</button>
          </div>
        </div>
        <div className="control-block">
          <div className="control-label">
            <span>Standoff</span>
            <span>{standoff.toFixed(0)} m</span>
          </div>
          <input
            type="range"
            min={10}
            max={45}
            step={1}
            value={standoff}
            onChange={(event) => onStandoff(Number(event.target.value))}
            className="range"
          />
        </div>
        <div className="control-block">
          <div className="control-label">
            <span>Wind injection</span>
            <span>{windSpeed.toFixed(1)} m/s</span>
          </div>
          <input
            type="range"
            min={0}
            max={14}
            step={0.5}
            value={windSpeed}
            onChange={(event) => onWind(Number(event.target.value))}
            className="range"
          />
        </div>
      </Panel>
    </aside>
  );
};
