import { BrainCircuit, Cpu, Fan, Radar, SlidersHorizontal } from 'lucide-react';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import type { RuntimeStats } from '../app/SimulationRuntime';
import { formatNumber } from './format';

interface PipelineStage {
  key: string;
  index: string;
  title: string;
  detail: string;
  value: string;
  sub: string;
  icon: typeof Radar;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

export const Pipeline = ({ snapshot, stats }: { snapshot: SimulationSnapshot; stats: RuntimeStats }) => {
  const perception = snapshot.perception;
  const control = snapshot.control;
  const sensorsTone = snapshot.sensors.satellites > 10 ? 'good' : 'warn';
  const plannerTone =
    snapshot.planner.status === 'EMERGENCY' || snapshot.planner.status === 'BLOCKED'
      ? 'bad'
      : snapshot.planner.status === 'AVOIDING'
        ? 'warn'
        : 'good';
  const trackTone =
    perception.trackStatus === 'TRACKING'
      ? 'good'
      : perception.trackStatus === 'COASTING' || perception.trackStatus === 'ACQUIRING'
        ? 'warn'
        : 'bad';
  const stages: PipelineStage[] = [
    {
      key: 'sense',
      index: '01',
      title: 'SENSE',
      detail: 'IMU · GNSS · EO',
      value: `${snapshot.sensors.satellites} SAT`,
      sub: `IMU 240 · GPS 8 · EO 30`,
      icon: Radar,
      tone: sensorsTone,
    },
    {
      key: 'estimate',
      index: '02',
      title: 'ESTIMATE',
      detail: '6-STATE EKF / CV TRACK',
      value: `${formatNumber(snapshot.estimate.positionSigma, 2)} M`,
      sub: `TRK ${perception.trackStatus}`,
      icon: BrainCircuit,
      tone: trackTone,
    },
    {
      key: 'plan',
      index: '03',
      title: 'PLAN',
      detail: 'MPC / 2.0 S HORIZON',
      value: snapshot.planner.status,
      sub: `${snapshot.planner.candidateCount || 82} CAND · ${formatNumber(snapshot.planner.clearance, 1)} M`,
      icon: SlidersHorizontal,
      tone: plannerTone,
    },
    {
      key: 'control',
      index: '04',
      title: 'CONTROL',
      detail: 'CASCADE / BODY RATE',
      value: `${formatNumber(control.thrust, 0)} N`,
      sub: `${formatNumber(control.torque.x, 2)} / ${formatNumber(control.torque.z, 2)} N·M`,
      icon: Cpu,
      tone: control.saturated ? 'warn' : 'good',
    },
    {
      key: 'actuate',
      index: '05',
      title: 'ACTUATE',
      detail: 'X-MIXER / 4 ROTORS',
      value: `${snapshot.drone.motors.filter((m) => m > 0.2).length}/4`,
      sub: `MOTOR BUS 240 HZ`,
      icon: Fan,
      tone: snapshot.drone.crashed ? 'bad' : 'good',
    },
  ];
  return (
    <div className="pipeline">
      <div className="pipeline__rail" />
      {stages.map((stage) => {
        const Icon = stage.icon;
        return (
          <div key={stage.key} className={`pipeline__stage pipeline__stage--${stage.tone}`}>
            <div className="pipeline__index mono">{stage.index}</div>
            <div className="pipeline__icon"><Icon size={15} strokeWidth={1.6} /></div>
            <div className="pipeline__copy">
              <div className="pipeline__title">{stage.title}<span>{stage.detail}</span></div>
              <strong>{stage.value}</strong>
              <em>{stage.sub}</em>
            </div>
            <span className="pipeline__led" />
          </div>
        );
      })}
      <div className="pipeline__footer mono">
        <span>AUTONOMY LOOP</span>
        <i />
        <span>{stats.paused ? 'HOLD' : 'RUNNING'}</span>
        <span className="pipeline__hz">240 HZ CORE</span>
      </div>
    </div>
  );
};
