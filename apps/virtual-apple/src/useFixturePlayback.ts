import { useEffect, useMemo, useState } from "react";
import { frameAt, getScenario, scenarioDuration } from "@apple/test-fixtures";

export function useFixturePlayback(initialScenario = "live") {
  const [scenarioId, setScenarioId] = useState(initialScenario);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const scenario = useMemo(() => getScenario(scenarioId), [scenarioId]);
  const durationMs = scenarioDuration(scenario);
  const activeFrame = frameAt(scenario, elapsedMs);

  useEffect(() => {
    if (!playing || durationMs === 0) return;
    const timer = window.setInterval(() => {
      setElapsedMs((current) => {
        const next = Math.min(durationMs, current + 50);
        if (next >= durationMs) window.setTimeout(() => setPlaying(false), 0);
        return next;
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [durationMs, playing]);

  function play(id: string) {
    setScenarioId(id);
    setElapsedMs(0);
    setPlaying(scenarioDuration(getScenario(id)) > 0);
  }

  return { scenario, scenarioId, elapsedMs, durationMs, activeFrame, playing, play, setPlaying };
}
