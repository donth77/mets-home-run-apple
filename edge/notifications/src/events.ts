import type { GameCore } from "@apple/game-core-wasm";
import type { NormalizedFeedCapture } from "@apple/mlb-live-feed";
import type { GameSnapshot, NormalizedGameInput, NormalizedPlayEvidence } from "@apple/protocol";
import type { VerifiedNotificationEvent } from "./types";

const BASELINE_CURSOR = "00000000_000000";

function scoreLine(snapshot: GameSnapshot) {
  return `${snapshot.away.abbreviation} ${snapshot.away.runs}, ${snapshot.home.abbreviation} ${snapshot.home.runs}`;
}

function inningLabel(snapshot: GameSnapshot) {
  if (snapshot.phase === "FINAL" || snapshot.half === "END") return "Final";
  const half = snapshot.half === "TOP" ? "Top" : snapshot.half === "BOTTOM" ? "Bottom" : "Mid";
  return `${half} ${snapshot.inning}`;
}

function notificationCopy(
  event: Pick<VerifiedNotificationEvent, "kind" | "subject">,
  snapshot: GameSnapshot,
): Pick<VerifiedNotificationEvent, "title" | "body"> {
  if (event.kind === "METS_WIN") {
    return {
      title: "Mets win!",
      body: `${scoreLine(snapshot)} · Put it in the books!`,
    };
  }
  return {
    title:
      event.kind === "GRAND_SLAM"
        ? `${event.subject || "A Met"} hit a grand slam!`
        : `${event.subject || "A Met"} hit a home run!`,
    body: `${scoreLine(snapshot)} · ${inningLabel(snapshot)}`,
  };
}

function replayInputs(
  input: NormalizedGameInput,
  eventKeys: ReadonlySet<string>,
  plays: readonly NormalizedPlayEvidence[],
  includesFinal: boolean,
) {
  return {
    baseline: {
      ...input,
      cursor: BASELINE_CURSOR,
      updateMode: "BOOTSTRAP" as const,
      phase: includesFinal ? ("LIVE" as const) : input.phase,
      plays: input.plays.filter((play) => !eventKeys.has(play.eventKey)),
    },
    update: {
      ...input,
      updateMode: "INCREMENTAL" as const,
      plays,
    },
  };
}

export async function verifiedNotificationEvents(
  capture: NormalizedFeedCapture,
  createGameCore: () => Promise<GameCore>,
  consumedEventKeys: ReadonlySet<string> = new Set(),
): Promise<readonly VerifiedNotificationEvent[]> {
  const candidates = [...capture.replayCandidates]
    .filter(({ eventKey }) => !consumedEventKeys.has(eventKey))
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  if (candidates.length === 0) return [];
  const candidateKeys = new Set(candidates.map(({ eventKey }) => eventKey));
  const candidatePlays = capture.coreInput.plays.filter(({ eventKey }) => candidateKeys.has(eventKey));
  const replay = replayInputs(
    capture.coreInput,
    candidateKeys,
    candidatePlays,
    candidateKeys.has(`${capture.coreInput.gamePk}:final`),
  );
  const verified: VerifiedNotificationEvent[] = [];
  const core = await createGameCore();
  try {
    core.ingest(replay.baseline, 0);
    core.ingest(replay.update, 1);
    for (const candidate of candidates) {
      const occurredAt = Date.parse(candidate.occurredAt);
      if (!Number.isFinite(occurredAt) || !core.ledgerContains(candidate.eventKey)) continue;
      const play = candidatePlays.find(({ eventKey }) => eventKey === candidate.eventKey);
      const kind = candidate.kind === "FINAL" ? "METS_WIN" : play?.kind;
      if (!kind || kind === "OTHER") continue;
      const subject = candidate.kind === "FINAL" ? "Mets Win!" : (play?.batterName ?? "A Met");
      const copy = notificationCopy({ kind, subject }, capture.gameSnapshot);
      verified.push({
        eventKey: candidate.eventKey,
        gamePk: capture.coreInput.gamePk,
        kind,
        subject,
        title: copy.title,
        body: copy.body,
        targetUrl: "/",
        occurredAt,
      });
    }
  } finally {
    core.dispose();
  }

  return verified;
}
