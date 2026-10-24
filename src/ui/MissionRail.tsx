import { Activity, Crosshair, ListChecks, RadioTower, Route, Target } from 'lucide-react';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import type { RuntimeStats } from '../app/SimulationRuntime';
import type { ScenarioDefinition } from '../core/world/types';
import { Panel, Bar, DataRow, StatusDot } from './components/Panel';
import {
  formatClock,
  formatCompass,
  formatNumber,
  formatSigned,
  phaseIndex,
  statusTone,
} from './format';

const PHASES = ['DEPART', 'ACQUIRE', 'PURSUIT', 'RTH', 'LAND'];

interface MissionRailProps {
  snapshot: SimulationSnapshot;
  stats: RuntimeStats;
  scenario: ScenarioDefinition;
}

export const MissionRail = ({ snapshot, stats, scenario }: MissionRailProps) => {
  const perception = snapshot.perception;
  const track = perception.trackStatus;
  const activeStep = phaseIndex(snapshot.mission.phase);
  const targetDetected = perception.trackInitialized;
  const slant = targetDetected ? Math.hypot(
    perception.trackPosition.x - snapshot.drone.position.x,
    perception.trackPosition.y - snapshot.drone.position.y,
    perception.trackPosition.z - snapshot.drone.position.z,
  ) : 0;
  const horizontal = targetDetected
    ? Math.hypot(
        perception.trackPosition.x - snapshot.drone.position.x,
        perception.trackPosition.z - snapshot.drone.position.z,
      )
    : 0;
  const trackSpeed = Math.hypot(perception.trackVelocity.x, perception.trackVelocity.z);
  const events = [...snapshot.events].slice(-7).reverse();
  const phaseTone = statusTone(track);
  const phaseProgress = snapshot.mission.phase === 'FAILED' ? 100 : Math.max(0, Math.min(100, (activeStep + 1) / PHASES.length * 100));

  return (
    <aside className="rail rail--left">
      <Panel title="Mission profile" eyebrow={`${scenario.code} / ${scenario.difficulty}`} icon={ListChecks} tone="accent">
        <div className="mission-heading">
          <div>
            <div className="mission-name">{scenario.name}</div>
            <div className="mission-sub">{scenario.description}</div>
          </div>
        </div>
        <div className="objective">
          <span className="micro-label">OBJECTIVE</span>
          <p>{scenario.objective}</p>
        </div>
        <div className="phase-card">
          <div className="phase-card__top">
            <div>
              <span className="micro-label">AUTONOMY PHASE</span>
              <strong>{snapshot.mission.phaseLabel}</strong>
            </div>
            <span className="phase-card__time mono">{formatClock(snapshot.mission.phaseTime)}</span>
          </div>
          <div className="phase-track">
            {PHASES.map((phase, index) => (
              <div
                key={phase}
                className={`phase-track__item ${index < activeStep ? 'is-passed' : ''} ${index === activeStep ? 'is-active' : ''} ${snapshot.mission.phase === 'FAILED' ? 'is-failed' : ''}`}
              >
                <i />
                <span>{phase}</span>
              </div>
            ))}
            <div className="phase-track__fill" style={{ width: `${phaseProgress}%` }} />
          </div>
        </div>
        <div className="mini-rows">
          <DataRow label="SIM RATE" value="240" unit="Hz" />
          <DataRow label="SIL FPS" value={formatNumber(stats.fps, 0)} unit="fps" />
          <DataRow label="BEHAVIOR" value={snapshot.mission.behavior === 'PURSUIT' ? 'PURSUIT' : 'OVERWATCH'} />
          <DataRow label="MISSION TIME" value={formatClock(snapshot.time)} />
        </div>
      </Panel>

      <Panel
        title="Visual subject"
        eyebrow={`${scenario.target.label} / ${scenario.target.vehicleClass}`}
        icon={Crosshair}
        action={<span className={`chip chip--${phaseTone}`}>{track}</span>}
      >
        <div className="target-hero">
          <div className="target-hero__glyph">
            <Target size={26} strokeWidth={1.2} />
            <span />
          </div>
          <div>
            <span className="micro-label">TRACK SOLUTION</span>
            <div className="target-hero__status">
              {targetDetected ? `${(perception.confidence * 100).toFixed(0)}%` : 'NO LOCK'}
              <em>{targetDetected ? 'CONFIDENCE' : 'WAITING FOR EO'}</em>
            </div>
          </div>
        </div>
        <div className="metric-grid metric-grid--three">
          <div className="mini-metric">
            <span className="micro-label">SLANT</span>
            <strong>{targetDetected ? formatNumber(slant, 0) : '—'}<em>m</em></strong>
          </div>
          <div className="mini-metric">
            <span className="micro-label">BEARING</span>
            <strong>{targetDetected ? formatCompass((perception.targetBearing * 180) / Math.PI) : '—'}</strong>
          </div>
          <div className="mini-metric">
            <span className="micro-label">TGT SPD</span>
            <strong>{targetDetected ? formatNumber(trackSpeed, 1) : '—'}<em>m/s</em></strong>
          </div>
        </div>
        <div className="target-details">
          <DataRow label="HORIZONTAL RANGE" value={targetDetected ? formatNumber(horizontal, 1) : '—'} unit="m" />
          <DataRow label="STANDOFF" value={targetDetected ? formatSigned(snapshot.mission.standoffError, 1) : '—'} unit="m" />
          <DataRow label="TRACK UPDATES" value={perception.updates} />
          <DataRow label="LAST SEEN" value={targetDetected ? `${formatNumber(perception.timeSinceUpdate, 2)}` : '—'} unit="s" />
        </div>
        <div className="confidence">
          <div className="confidence__label">
            <span>TRACK CONFIDENCE</span>
            <span className="mono">{targetDetected ? `${(perception.confidence * 100).toFixed(0)}%` : '0%'}</span>
          </div>
          <Bar value={targetDetected ? perception.confidence : 0} tone={phaseTone === 'bad' ? 'orange' : 'cyan'} />
        </div>
      </Panel>

      <Panel title="Event stream" eyebrow="AUTONOMY / PERCEPTION / SAFETY" icon={RadioTower} className="event-panel">
        <div className="event-list">
          {events.map((event) => (
            <div key={event.id} className={`event event--${event.severity}`}>
              <div className="event__dot" />
              <div className="event__body">
                <div className="event__meta">
                  <span>{formatClock(event.time)}</span>
                  <b>{event.source}</b>
                </div>
                <p>{event.message}</p>
              </div>
            </div>
          ))}
          {events.length === 0 ? <div className="empty-state">No events recorded.</div> : null}
        </div>
        <div className="event-panel__footer">
          <Activity size={12} />
          <span>DETERMINISTIC EVENT LOG</span>
          <em>{snapshot.events.length} / 48</em>
        </div>
      </Panel>

      <div className="rail__foot">
        <Route size={12} />
        <span>{scenario.seed.toString(16).toUpperCase()} / SEED LOCKED</span>
        <StatusDot tone={snapshot.drone.crashed ? 'bad' : stats.paused ? 'warn' : 'good'} pulse={!stats.paused} />
      </div>
    </aside>
  );
};
