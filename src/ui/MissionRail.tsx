import { Activity, Crosshair, Route } from 'lucide-react';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import type { ScenarioDefinition } from '../core/world/types';
import { Panel, Bar, StatusDot } from './components/Panel';
import {
  formatClock,
  formatCompass,
  formatNumber,
  formatSigned,
  phaseIndex,
  statusTone,
} from './format';

const PHASES = ['Depart', 'Acquire', 'Pursue', 'Return', 'Land'];

interface MissionRailProps {
  snapshot: SimulationSnapshot;
  scenario: ScenarioDefinition;
}

export const MissionRail = ({ snapshot, scenario }: MissionRailProps) => {
  const perception = snapshot.perception;
  const track = perception.trackStatus;
  const detected = perception.trackInitialized;
  const activeStep = phaseIndex(snapshot.mission.phase);
  const horizontal = detected
    ? Math.hypot(
        perception.trackPosition.x - snapshot.drone.position.x,
        perception.trackPosition.z - snapshot.drone.position.z,
      )
    : 0;
  const slant = detected
    ? Math.hypot(
        perception.trackPosition.x - snapshot.drone.position.x,
        perception.trackPosition.y - snapshot.drone.position.y,
        perception.trackPosition.z - snapshot.drone.position.z,
      )
    : 0;
  const speed = Math.hypot(perception.trackVelocity.x, perception.trackVelocity.z);
  const events = [...snapshot.events].slice(-5).reverse();
  const tone = statusTone(track);
  const progress = snapshot.mission.phase === 'FAILED' ? 100 : Math.max(0, ((activeStep + 1) / PHASES.length) * 100);

  return (
    <aside className="rail rail--left">
      <Panel title="Mission" eyebrow={`${scenario.code} / ${scenario.difficulty}`} icon={Route}>
        <h1 className="mission-title">{scenario.name}</h1>
        <p className="mission-copy">{scenario.description}</p>
        <div className="objective">
          <span>Objective</span>
          <p>{scenario.objective}</p>
        </div>
        <div className="phase-summary">
          <div>
            <span>Current phase</span>
            <strong>{snapshot.mission.phaseLabel}</strong>
          </div>
          <span className="phase-summary__time">{formatClock(snapshot.mission.phaseTime)}</span>
        </div>
        <div className="stepper">
          <div className="stepper__track">
            <i style={{ width: `${progress}%` }} />
          </div>
          <div className="stepper__labels">
            {PHASES.map((phase, index) => (
              <span
                key={phase}
                className={`${index === activeStep ? 'is-active' : ''} ${index < activeStep ? 'is-passed' : ''} ${snapshot.mission.phase === 'FAILED' ? 'is-failed' : ''}`}
              >
                <i />
                {phase}
              </span>
            ))}
          </div>
        </div>
      </Panel>

      <Panel
        title="Subject"
        eyebrow={`${scenario.target.label} / ${scenario.target.vehicleClass}`}
        icon={Crosshair}
        action={<span className={`badge badge--${tone}`}>{track}</span>}
      >
        <div className="lock-row">
          <strong>{detected ? `${(perception.confidence * 100).toFixed(0)}%` : '--'}</strong>
          <div className="lock-row__meta">
            <span>{detected ? 'Track confidence' : 'Waiting for visual contact'}</span>
            <Bar value={detected ? perception.confidence : 0} tone={tone === 'bad' ? 'orange' : 'green'} />
          </div>
        </div>
        <div className="subject-stats">
          <div>
            <span>Range</span>
            <strong>{detected ? formatNumber(slant, 0) : '--'}<em>m</em></strong>
          </div>
          <div>
            <span>Bearing</span>
            <strong>{detected ? formatCompass((perception.targetBearing * 180) / Math.PI) : '--'}</strong>
          </div>
          <div>
            <span>Speed</span>
            <strong>{detected ? formatNumber(speed, 1) : '--'}<em>m/s</em></strong>
          </div>
        </div>
        <div className="subject-footer">
          <span>Standoff {formatSigned(snapshot.mission.standoffError, 1)} m</span>
          <span>{perception.updates} updates</span>
          <span>LOS {detected ? 'valid' : 'lost'}</span>
        </div>
        <div className="subject-range">
          <span>Horizontal separation</span>
          <span>{detected ? `${formatNumber(horizontal, 1)} m` : '--'}</span>
        </div>
      </Panel>

      <Panel title="Activity" eyebrow="Autonomy and perception" icon={Activity} className="activity-panel">
        <div className="activity-list">
          {events.map((event) => (
            <div key={event.id} className={`activity-item activity-item--${event.severity}`}>
              <StatusDot tone={event.severity === 'critical' ? 'bad' : event.severity === 'warn' ? 'warn' : event.severity === 'success' ? 'good' : 'neutral'} />
              <div>
                <div className="activity-item__meta">
                  <span>{formatClock(event.time)}</span>
                  <span>{event.source}</span>
                </div>
                <p>{event.message}</p>
              </div>
            </div>
          ))}
          {events.length === 0 ? <p className="empty-state">No activity yet.</p> : null}
        </div>
      </Panel>
    </aside>
  );
};
