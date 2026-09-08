import { useEffect, useMemo, useState } from "react";
import type { FixtureScenario } from "@apple/protocol";
import { frameAt, getScenario, nextFrameAt, scenarioDuration } from "@apple/test-fixtures";

export function useFixturePlayback(initialScenario = "home-run", extraScenarios: readonly FixtureScenario[] = []) {
  const [scenarioId, setScenarioId] = useState(initialScenario);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Scenarios the Lab builds at runtime (the owner's custom one) sit beside
  // the compiled fixtures and are looked up first.
  const scenario = useMemo(
    () => extraScenarios.find((candidate) => candidate.id === scenarioId) ?? getScenario(scenarioId),
    [extraScenarios, scenarioId],
  );
  const durationMs = scenarioDuration(scenario);
  const activeFrame = frameAt(scenario, elapsedMs);

  useEffect(() => {
    if (!playing || durationMs === 0) return;
    const timer = window.setInterval(() => {
      setElapsedMs((current) => {
        const next = Math.min(durationMs, current + 50 * speed);
        if (next >= durationMs) window.setTimeout(() => setPlaying(false), 0);
        return next;
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [durationMs, playing, speed]);

  function selectScenario(nextId: string, autoPlay = false) {
    setScenarioId(nextId);
    setElapsedMs(0);
    setPlaying(autoPlay);
  }

  function reset() {
    setElapsedMs(0);
    setPlaying(false);
  }

  function step() {
    setPlaying(false);
    setElapsedMs((current) => nextFrameAt(scenario, current));
  }

  return {
    scenario,
    scenarioId,
    elapsedMs,
    durationMs,
    activeFrame,
    playing,
    speed,
    selectScenario,
    setElapsedMs,
    setPlaying,
    setSpeed,
    reset,
    step,
  };
}
