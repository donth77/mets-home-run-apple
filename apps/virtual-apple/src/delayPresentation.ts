import type { GameSnapshot } from "@apple/protocol";

type DelaySnapshot = Pick<GameSnapshot, "label" | "phase">;

export function isRainDelayPresentation(snapshot: DelaySnapshot) {
  return snapshot.phase === "DELAYED" && snapshot.label.trim().toUpperCase() === "RAIN DELAY";
}

export function delayWidgetLabel(snapshot: DelaySnapshot) {
  if (snapshot.phase !== "DELAYED") return snapshot.label;
  return isRainDelayPresentation(snapshot) ? "RAIN DELAY" : "DELAY";
}
