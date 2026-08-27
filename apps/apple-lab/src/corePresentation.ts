import type { CoreResult } from "@apple/game-core-wasm";
import type { PresentationSnapshot } from "@apple/protocol";

export function appleLabPresentationSnapshot(
  snapshot: PresentationSnapshot,
  decision: Pick<CoreResult, "events"> | undefined,
): PresentationSnapshot {
  const celebrationEvent = [...(decision?.events ?? [])].reverse().find(({ type }) => type === "CELEBRATION_STARTED");
  if (!celebrationEvent) return snapshot;

  const label =
    celebrationEvent.celebration === "GRAND_SLAM"
      ? "GRAND SLAM!!"
      : celebrationEvent.celebration === "METS_WIN"
        ? "METS WIN!"
        : "HOME RUN!";
  return { ...snapshot, phase: "CELEBRATION", label };
}
