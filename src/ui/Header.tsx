import { ChevronDown, Pause, Play, RotateCcw, ShieldCheck, Signal, TriangleAlert } from 'lucide-react';
import type { ScenarioDefinition } from '../core/world/types';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import type { RuntimeStats } from '../app/SimulationRuntime';
import { formatClock, formatMissionTime } from './format';

interface HeaderProps {
  scenarios: readonly ScenarioDefinition[];
  scenario: ScenarioDefinition;
  snapshot: SimulationSnapshot;
  stats: RuntimeStats;
  onScenario: (id: string) => void;
  onTogglePause: () => void;
  onReset: () => void;
  onSpeed: (speed: number) => void;
}

export const Header = ({
  scenarios,
  scenario,
  snapshot,
  stats,
  onScenario,
  onTogglePause,
  onReset,
  onSpeed,
}: HeaderProps) => {
  const failed = snapshot.drone.crashed || snapshot.mission.phase === 'FAILED';
  const status = failed ? 'FAULT' : stats.paused ? 'HOLD' : 'AUTONOMY ACTIVE';
  const statusClass = failed ? 'is-bad' : stats.paused ? 'is-warn' : 'is-good';
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand__mark" aria-hidden>
          <svg viewBox="0 0 32 32">
            <path d="M16 2.5 28 9.2v13.6L16 29.5 4 22.8V9.2Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M16 8.2 22.4 12v8L16 23.8 9.6 20v-8Z" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
            <circle cx="16" cy="16" r="2.4" fill="currentColor" />
            <path d="M16 4.5v5M16 22.5v5M5.8 10.4l4.3 2.5M21.9 19.1l4.3 2.5M26.2 10.4l-4.3 2.5M10.1 19.1l-4.3 2.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
          </svg>
        </div>
        <div className="brand__type">
          <div className="brand__name">SENTINEL</div>
          <div className="brand__sub">AUTONOMY LAB / SIMULATION CELL</div>
        </div>
      </div>

      <div className="topbar__divider" />

      <div className="scenario-select">
        <span className="scenario-select__label">SCENARIO</span>
        <div className="select-shell">
          <select value={scenario.id} onChange={(event) => onScenario(event.target.value)}>
            {scenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>
      </div>

      <div className="topbar__meta">
        <div className="topbar__meta-item">
          <span className="micro-label">MISSION CLOCK</span>
          <span className="mono topbar__clock">{formatMissionTime(snapshot.time)}</span>
        </div>
        <div className="topbar__meta-item topbar__meta-item--hide-small">
          <span className="micro-label">PHASE</span>
          <span className="mono topbar__phase">{snapshot.mission.phase}</span>
        </div>
        <div className="topbar__meta-item topbar__meta-item--hide-small">
          <span className="micro-label">WALL</span>
          <span className="mono">{formatClock(stats.wallTime)}</span>
        </div>
      </div>

      <div className="topbar__spacer" />

      <div className={`live-status ${statusClass}`}>
        {failed ? <TriangleAlert size={13} /> : stats.paused ? <Pause size={12} /> : <Signal size={13} />}
        <span>{status}</span>
        <i />
      </div>

      <div className="speed-control" aria-label="Simulation speed">
        {[1, 2, 4].map((speed) => (
          <button
            type="button"
            key={speed}
            className={stats.speed === speed ? 'is-active' : ''}
            onClick={() => onSpeed(speed)}
          >
            {speed}×
          </button>
        ))}
      </div>

      <div className="topbar__actions">
        <button type="button" className="icon-button icon-button--primary" onClick={onTogglePause} title={stats.paused ? 'Resume simulation' : 'Pause simulation'}>
          {stats.paused ? <Play size={15} /> : <Pause size={15} />}
        </button>
        <button type="button" className="icon-button" onClick={onReset} title="Reset scenario">
          <RotateCcw size={15} />
        </button>
        <div className="integrity" title="Simulation integrity monitor">
          <ShieldCheck size={14} />
          <span>SIL</span>
        </div>
      </div>
    </header>
  );
};
