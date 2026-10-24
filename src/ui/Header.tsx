import { ChevronDown, Maximize2, Minimize2, Pause, Play, RotateCcw } from 'lucide-react';
import type { ScenarioDefinition } from '../core/world/types';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import type { RuntimeStats } from '../app/SimulationRuntime';
import { formatMissionTime } from './format';

interface HeaderProps {
  scenarios: readonly ScenarioDefinition[];
  scenario: ScenarioDefinition;
  snapshot: SimulationSnapshot;
  stats: RuntimeStats;
  focusMode: boolean;
  onScenario: (id: string) => void;
  onTogglePause: () => void;
  onReset: () => void;
  onSpeed: (speed: number) => void;
  onToggleFocus: () => void;
}

export const Header = ({
  scenarios,
  scenario,
  snapshot,
  stats,
  focusMode,
  onScenario,
  onTogglePause,
  onReset,
  onSpeed,
  onToggleFocus,
}: HeaderProps) => {
  const failed = snapshot.drone.crashed || snapshot.mission.phase === 'FAILED';
  const state = failed ? 'Fault' : stats.paused ? 'Paused' : 'Live';
  const tone = failed ? 'bad' : stats.paused ? 'warn' : 'good';

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand__mark" aria-hidden>
          <svg viewBox="0 0 32 32">
            <path d="M16 3 28 9.4v13.2L16 29 4 22.6V9.4Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M16 9 22 12.4v7.2L16 23l-6-3.4v-7.2Z" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
            <circle cx="16" cy="16" r="2.2" fill="currentColor" />
          </svg>
        </div>
        <div>
          <div className="brand__name">Sentinel</div>
          <div className="brand__sub">Autonomy Lab</div>
        </div>
      </div>

      <label className="scenario-picker">
        <span>Scenario</span>
        <div className="select-shell">
          <select value={scenario.id} onChange={(event) => onScenario(event.target.value)}>
            {scenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
      </label>

      <div className="topbar__spacer" />

      <div className="topbar__clock">
        <span>Mission time</span>
        <strong>{formatMissionTime(snapshot.time)}</strong>
      </div>

      <div className={`status-pill status-pill--${tone}`}>
        <i />
        <span>{state}</span>
      </div>

      <div className="speed-toggle" aria-label="Simulation speed">
        {[1, 2, 4].map((speed) => (
          <button
            type="button"
            key={speed}
            className={stats.speed === speed ? 'is-active' : ''}
            onClick={() => onSpeed(speed)}
          >
            {speed}x
          </button>
        ))}
      </div>

      <div className="topbar__actions">
        <button type="button" className="icon-button" onClick={onTogglePause} title={stats.paused ? 'Resume' : 'Pause'}>
          {stats.paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button type="button" className="icon-button" onClick={onReset} title="Reset mission">
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          className={`icon-button ${focusMode ? 'is-active' : ''}`}
          onClick={onToggleFocus}
          title={focusMode ? 'Show panels' : 'Focus viewport'}
        >
          {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
    </header>
  );
};
