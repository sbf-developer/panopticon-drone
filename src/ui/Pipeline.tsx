import { BrainCircuit, Cpu, Fan, Radar, SlidersHorizontal } from 'lucide-react';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import type { RuntimeStats } from '../app/SimulationRuntime';
import { formatNumber } from './format';

interface PipelineStage {
  key: string;
  title: string;
  value: string;
  icon: typeof Radar;
  tone: 'good' | 'warn' | 'bad';
}

export const Pipeline = ({ snapshot, stats }: { snapshot: SimulationSnapshot; stats: RuntimeStats }) => {
  const perception = snapshot.perception;
  const control = snapshot.control;
  const trackTone =
    perception.trackStatus === 'TRACKING'
      ? 'good'
      : perception.trackStatus === 'COASTING' || perception.trackStatus === 'ACQUIRING'
        ? 'warn'
        : 'bad';
  const plannerTone =
    snapshot.planner.status === 'EMERGENCY' || snapshot.planner.status === 'BLOCKED'
      ? 'bad'
      : snapshot.planner.status === 'AVOIDING'
        ? 'warn'
        : 'good';
  const stages: PipelineStage[] = [
    {
      key: 'sense',
      title: 'Sense',
      value: `${snapshot.sensors.satellites} sats`,
      icon: Radar,
      tone: snapshot.sensors.satellites > 10 ? 'good' : 'warn',
    },
    {
      key: 'estimate',
      title: 'Estimate',
      value: `${formatNumber(snapshot.estimate.positionSigma, 2)} m`,
      icon: BrainCircuit,
      tone: trackTone,
    },
    {
      key: 'plan',
      title: 'Plan',
      value: snapshot.planner.status.toLowerCase(),
      icon: SlidersHorizontal,
      tone: plannerTone,
    },
    {
      key: 'control',
      title: 'Control',
      value: `${formatNumber(control.thrust, 0)} N`,
      icon: Cpu,
      tone: control.saturated ? 'warn' : 'good',
    },
    {
      key: 'actuate',
      title: 'Actuate',
      value: `${snapshot.drone.motors.filter((motor) => motor > 0.2).length}/4`,
      icon: Fan,
      tone: snapshot.drone.crashed ? 'bad' : 'good',
    },
  ];

  return (
    <div className="pipeline">
      <div className="pipeline__heading">
        <span>Autonomy stack</span>
        <strong>240 Hz core</strong>
      </div>
      <div className="pipeline__stages">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <div key={stage.key} className="pipeline__stage">
              <Icon size={14} strokeWidth={1.6} />
              <div>
                <span>{stage.title}</span>
                <strong>{stage.value}</strong>
              </div>
              <i className={`pipeline__dot pipeline__dot--${stage.tone}`} />
              {index < stages.length - 1 ? <b className="pipeline__link" /> : null}
            </div>
          );
        })}
      </div>
      <div className="pipeline__state">
        <i className={stats.paused ? 'is-warn' : 'is-good'} />
        <span>{stats.paused ? 'Hold' : 'Running'}</span>
      </div>
    </div>
  );
};
