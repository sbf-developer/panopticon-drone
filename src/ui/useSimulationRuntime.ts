import { useCallback, useEffect, useRef, useState } from 'react';
import { SimulationRuntime, type RuntimeStats } from '../app/SimulationRuntime';
import type { SimulationSnapshot } from '../core/sim/snapshot';
import type { FollowBehavior } from '../core/sim/mission';

export interface RuntimeData {
  snapshot: SimulationSnapshot;
  stats: RuntimeStats;
}

export interface SimulationControls {
  data: RuntimeData | null;
  runtime: SimulationRuntime | null;
  scenarioId: string;
  selectScenario: (id: string) => void;
  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
  reset: () => void;
  setSpeed: (speed: number) => void;
  setBehavior: (behavior: FollowBehavior) => void;
  setStandoff: (meters: number) => void;
  setWind: (speed: number, fromDegrees: number) => void;
  error: Error | null;
}

export const useSimulationRuntime = (initialScenario: string): SimulationControls => {
  const runtimeRef = useRef<SimulationRuntime | null>(null);
  const [data, setData] = useState<RuntimeData | null>(null);
  const [scenarioId, setScenarioId] = useState(initialScenario);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const runtime = new SimulationRuntime(initialScenario, (snapshot, stats) => {
      setData({ snapshot, stats });
    });
    runtimeRef.current = runtime;
    const errorTimer = window.setInterval(() => {
      const current = runtime.getError();
      if (current) setError(current);
    }, 2000);
    return () => {
      window.clearInterval(errorTimer);
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [initialScenario]);

  const selectScenario = useCallback((id: string) => {
    setScenarioId(id);
    runtimeRef.current?.setScenario(id);
    runtimeRef.current?.setPaused(false);
  }, []);

  const setPaused = useCallback((paused: boolean) => runtimeRef.current?.setPaused(paused), []);
  const togglePaused = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime) runtime.setPaused(!runtime.paused);
  }, []);
  const reset = useCallback(() => runtimeRef.current?.reset(), []);
  const setSpeed = useCallback((speed: number) => runtimeRef.current?.setSpeed(speed), []);
  const setBehavior = useCallback(
    (behavior: FollowBehavior) => runtimeRef.current?.setBehavior(behavior),
    [],
  );
  const setStandoff = useCallback((meters: number) => runtimeRef.current?.setStandoff(meters), []);
  const setWind = useCallback(
    (speed: number, fromDegrees: number) => runtimeRef.current?.setWind(speed, fromDegrees),
    [],
  );

  return {
    data,
    runtime: runtimeRef.current,
    scenarioId,
    selectScenario,
    setPaused,
    togglePaused,
    reset,
    setSpeed,
    setBehavior,
    setStandoff,
    setWind,
    error,
  };
};
