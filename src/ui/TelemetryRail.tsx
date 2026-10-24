import { BatteryCharging, Cpu, Gauge, Map, Satellite, SlidersHorizontal, Wind } from 'lucide-react';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import type { RuntimeStats } from '../app/SimulationRuntime';
import type { ScenarioDefinition } from '../core/world/types';
import type { FollowBehavior } from '../core/sim/mission';
import { Panel, Bar, DataRow } from './components/Panel';
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
  const batteryTone = drone.batteryPercent < 15 ? 'orange' : drone.batteryPercent < 30 ? 'amber' : 'cyan';
  const linkQuality = Math.max(0.18, 1 - snapshot.sensors.positionSigma / 3.2);
  return (
    <aside className="rail rail--right">
      <Panel
        title="Flight state"
        eyebrow="NAV / AHRS / EKF"
        icon={Gauge}
        action={<span className="mono subtle-text">{formatNumber(stats.fps, 0)} FPS</span>}
      >
        <div className="telemetry-hero">
          <div className="telemetry-hero__metric">
            <span className="micro-label">ALTITUDE / MSL</span>
            <strong>{formatNumber(drone.altitude, 1)}<em>m</em></strong>
            <span className="mono subtle-text">AGL {formatNumber(drone.agl, 1)} m</span>
          </div>
          <div className="telemetry-hero__metric">
            <span className="micro-label">GROUND SPEED</span>
            <strong>{formatNumber(drone.horizontalSpeed, 1)}<em>m/s</em></strong>
            <span className="mono subtle-text">V/S {drone.verticalSpeed >= 0 ? '+' : ''}{formatNumber(drone.verticalSpeed, 1)}</span>
          </div>
        </div>
        <AttitudeIndicator snapshot={snapshot} />
        <div className="metric-grid metric-grid--four">
          <div className="mini-metric">
            <span className="micro-label">HEADING</span>
            <strong>{formatCompass(drone.heading)}</strong>
          </div>
          <div className="mini-metric">
            <span className="micro-label">THROTTLE</span>
            <strong>{(drone.throttle * 100).toFixed(0)}<em>%</em></strong>
          </div>
          <div className="mini-metric">
            <span className="micro-label">BATTERY</span>
            <strong>{drone.batteryPercent.toFixed(0)}<em>%</em></strong>
          </div>
          <div className="mini-metric">
            <span className="micro-label">V-LINK</span>
            <strong>{(linkQuality * 100).toFixed(0)}<em>%</em></strong>
          </div>
        </div>
        <div className="battery-line">
          <div className="battery-line__label">
            <span><BatteryCharging size={12} /> 6S / 5000 MAH</span>
            <span className="mono">{formatNumber(drone.voltage, 1)} V · {formatNumber(drone.current, 1)} A</span>
          </div>
          <Bar value={drone.batteryPercent / 100} tone={batteryTone} />
        </div>
      </Panel>

      <Panel title="Onboard systems" eyebrow="SENSOR FUSION" icon={Cpu}>
        <div className="systems-grid">
          <div className="system-chip">
            <Satellite size={14} />
            <div>
              <span className="micro-label">GNSS</span>
              <strong>{snapshot.sensors.satellites} SAT / {formatNumber(snapshot.sensors.hdop, 1)}</strong>
            </div>
            <i className={snapshot.sensors.satellites > 10 ? 'is-ok' : 'is-warn'} />
          </div>
          <div className="system-chip">
            <Wind size={14} />
            <div>
              <span className="micro-label">WIND / FROM</span>
              <strong>{formatNumber(snapshot.wind.speed, 1)} m/s · {formatCompass(snapshot.wind.fromDegrees)}</strong>
            </div>
            <i className={snapshot.wind.speed > 8 ? 'is-warn' : 'is-ok'} />
          </div>
        </div>
        <div className="mini-rows mini-rows--tight">
          <DataRow label="NAV POSITION σ" value={formatNumber(snapshot.estimate.positionSigma, 2)} unit="m" />
          <DataRow label="NAV VELOCITY σ" value={formatNumber(snapshot.estimate.velocitySigma, 2)} unit="m/s" />
          <DataRow label="PLANNER CLEARANCE" value={formatNumber(snapshot.planner.clearance, 1)} unit="m" />
          <DataRow
            label="PLANNER STATUS"
            value={<span className={`inline-status inline-status--${snapshot.planner.status === 'EMERGENCY' || snapshot.planner.status === 'BLOCKED' ? 'bad' : snapshot.planner.status === 'AVOIDING' ? 'warn' : 'good'}`}>{snapshot.planner.status}</span>}
          />
          <DataRow label="GPS NIS" value={formatNumber(snapshot.sensors.gpsNis, 1)} />
          <DataRow label="IMU AIDING" value={snapshot.sensors.accelRejected ? 'GYRO PRIMARY' : 'GNSS-AIDED'} />
        </div>
      </Panel>

      <Panel title="Operational map" eyebrow={`${scenario.code} / 380 M GRID`} icon={Map}>
        <MiniMap scenario={scenario} snapshot={snapshot} />
        <div className="map-legend">
          <span><i className="legend-dot legend-dot--uav" /> UAV</span>
          <span><i className="legend-dot legend-dot--tgt" /> TRACK</span>
          <span><i className="legend-dot legend-dot--home" /> HOME</span>
          <span className="mono">N ↑</span>
        </div>
      </Panel>

      <Panel title="Autonomy control" eyebrow="OPERATOR PARAMETERS" icon={SlidersHorizontal}>
        <div className="control-block">
          <div className="control-label">
            <span>FOLLOW BEHAVIOUR</span>
            <span className="mono">{behavior}</span>
          </div>
          <div className="segmented">
            <button type="button" className={behavior === 'PURSUIT' ? 'is-active' : ''} onClick={() => onBehavior('PURSUIT')}>PURSUIT</button>
            <button type="button" className={behavior === 'OVERWATCH' ? 'is-active' : ''} onClick={() => onBehavior('OVERWATCH')}>OVERWATCH</button>
          </div>
        </div>
        <div className="control-block">
          <div className="control-label">
            <span>STANDOFF DISTANCE</span>
            <span className="mono">{standoff.toFixed(0)} m</span>
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
          <div className="range-scale"><span>10</span><span>45</span></div>
        </div>
        <div className="control-block">
          <div className="control-label">
            <span>WIND INJECTION</span>
            <span className="mono">{windSpeed.toFixed(1)} m/s</span>
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
          <div className="range-scale"><span>CALM</span><span>GUST 14</span></div>
        </div>
        <div className="control-note">
          <span>PARAMETERS APPLY LIVE</span>
          <span className="mono">SEED {scenario.seed.toString(16).toUpperCase()}</span>
        </div>
      </Panel>
    </aside>
  );
};
