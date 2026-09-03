import { type InterruptionKind, interruptionKind, type PresentationSnapshot } from "@apple/protocol";

type DelaySnapshot = Pick<PresentationSnapshot, "label" | "phase">;

const HEADLINES: Record<InterruptionKind, string> = {
  DELAY: "DELAY",
  RAIN_DELAY: "RAIN DELAY",
  SUSPENDED: "SUSPENDED",
  POSTPONED: "POSTPONED",
  CANCELLED: "CANCELLED",
};

export function isRainDelayPresentation(snapshot: DelaySnapshot) {
  return snapshot.phase === "DELAYED" && interruptionKind(snapshot) === "RAIN_DELAY";
}

/** Headline for the moment card: one word per interruption, never MLB's raw text. */
export function delayWidgetLabel(snapshot: DelaySnapshot) {
  if (snapshot.phase !== "DELAYED") return snapshot.label;
  return HEADLINES[interruptionKind(snapshot)];
}
