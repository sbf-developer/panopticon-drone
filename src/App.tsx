import { useEffect, useState } from 'react';
import { getScenario, getScenarios } from './core/world/scenarios';
import type { FollowBehavior } from './core/sim/mission';
import type { CameraMode, DebugOptions } from './render/SimulationView';
import { useSimulationRuntime } from './ui/useSimulationRuntime';
import { Header } from './ui/Header';
import { MissionRail } from './ui/MissionRail';
import { TelemetryRail } from './ui/TelemetryRail';
import { Viewport } from './ui/Viewport';
import { Pipeline } from './ui/Pipeline';

const SCENARIOS = getScenarios();

export const App = () => {
  const controls = useSimulationRuntime('campus');
  const { data, runtime, scenarioId } = controls;
  const scenario = getScenario(scenarioId);
  const [cameraMode, setCameraMode] = useState<CameraMode>('ORBIT');
  const [debug, setDebug] = useState<DebugOptions>({
    plan: true,
    track: true,
    sensor: false,
    labels: true,
  });
  const [behavior, setBehavior] = useState<FollowBehavior>('PURSUIT');
  const [standoff, setStandoff] = useState(scenario.drone.standoff);
  const [windSpeed, setWindSpeed] = useState(scenario.weather.windSpeed);

  useEffect(() => {
    setBehavior('PURSUIT');
    setStandoff(scenario.drone.standoff);
    setWindSpeed(scenario.weather.windSpeed);
    runtime?.setBehavior('PURSUIT');
    runtime?.setStandoff(scenario.drone.standoff);
    runtime?.setWind(scenario.weather.windSpeed, scenario.weather.windFromDeg);
  }, [scenarioId, runtime, scenario.drone.standoff, scenario.weather.windSpeed, scenario.weather.windFromDeg]);

  const handleBehavior = (next: FollowBehavior): void => {
    setBehavior(next);
    runtime?.setBehavior(next);
  };

  const handleStandoff = (value: number): void => {
    setStandoff(value);
    runtime?.setStandoff(value);
  };

  const handleWind = (value: number): void => {
    setWindSpeed(value);
    runtime?.setWind(value, scenario.weather.windFromDeg);
  };

  if (!data || !runtime) {
    return (
      <div className="boot-screen">
        <div className="boot-screen__radar">
          <span />
          <span />
          <span />
          <div />
        </div>
        <div className="boot-screen__title">SENTINEL</div>
        <div className="boot-screen__sub">INITIALIZING AUTONOMY STACK</div>
        <div className="boot-screen__bar"><i /></div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        scenarios={SCENARIOS}
        scenario={scenario}
        snapshot={data.snapshot}
        stats={data.stats}
        onScenario={controls.selectScenario}
        onTogglePause={controls.togglePaused}
        onReset={controls.reset}
        onSpeed={controls.setSpeed}
      />
      <main className="workspace">
        <MissionRail snapshot={data.snapshot} stats={data.stats} scenario={scenario} />
        <section className="center-column">
          <Viewport
            runtime={runtime}
            snapshot={data.snapshot}
            stats={data.stats}
            scenario={scenario}
            cameraMode={cameraMode}
            onCameraMode={setCameraMode}
            debug={debug}
            onDebug={setDebug}
          />
          <Pipeline snapshot={data.snapshot} stats={data.stats} />
        </section>
        <TelemetryRail
          snapshot={data.snapshot}
          stats={data.stats}
          scenario={scenario}
          behavior={behavior}
          standoff={standoff}
          windSpeed={windSpeed}
          onBehavior={handleBehavior}
          onStandoff={handleStandoff}
          onWind={handleWind}
        />
      </main>
      {controls.error ? (
        <div className="fatal-banner">
          SIMULATION HALTED: {controls.error.message}
        </div>
      ) : null}
      <div className="ambient-glow ambient-glow--one" />
      <div className="ambient-glow ambient-glow--two" />
    </div>
  );
};
