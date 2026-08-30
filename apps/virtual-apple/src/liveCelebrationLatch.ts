import { METS_TEAM_ID, type NormalizedFeedCapture } from "@apple/mlb-live-feed";
import type { GameSnapshot, NormalizedGameInput } from "@apple/protocol";
import type { LiveCorePresentation } from "./liveGameCoreController";

function metsWon(input: NormalizedGameInput) {
  if (input.homeTeamId === METS_TEAM_ID) return input.homeRuns > input.awayRuns;
  if (input.awayTeamId === METS_TEAM_ID) return input.awayRuns > input.homeRuns;
  return false;
}

function cacheableHomeRun(play: NormalizedGameInput["plays"][number]) {
  return (
    play.battingTeamId === METS_TEAM_ID &&
    play.complete &&
    (play.kind === "HOME_RUN" || play.kind === "GRAND_SLAM") &&
    (play.review === "NONE" || play.review === "CONFIRMED")
  );
}

/**
 * Keeps the fan-facing scoreboard on the event that is currently celebrating.
 * The feed and C++ core continue advancing in the background, so additional
 * home runs can still be detected and queued safely.
 */
export class LiveCelebrationLatch {
  #activeEventKey: string | undefined;
  #displayedSnapshot: GameSnapshot | undefined;
  #eventSnapshots = new Map<string, GameSnapshot>();
  #latestSnapshot: GameSnapshot | undefined;

  recordCapture(capture: Pick<NormalizedFeedCapture, "coreInput" | "gameSnapshot">) {
    this.#latestSnapshot = capture.gameSnapshot;
    for (const play of capture.coreInput.plays) {
      if (cacheableHomeRun(play)) this.#eventSnapshots.set(play.eventKey, capture.gameSnapshot);
    }
    if (capture.coreInput.phase === "FINAL" && metsWon(capture.coreInput)) {
      this.#eventSnapshots.set(`${capture.coreInput.gamePk}:final`, capture.gameSnapshot);
    }
  }

  accept(presentation: LiveCorePresentation, fallbackSnapshot?: GameSnapshot) {
    const nextEventKey = presentation.celebration?.eventKey;
    if (nextEventKey) {
      if (nextEventKey !== this.#activeEventKey) {
        if (this.#activeEventKey) this.#eventSnapshots.delete(this.#activeEventKey);
        this.#activeEventKey = nextEventKey;
        this.#displayedSnapshot =
          this.#eventSnapshots.get(nextEventKey) ?? fallbackSnapshot ?? this.#latestSnapshot ?? this.#displayedSnapshot;
      }
    } else {
      if (this.#activeEventKey) this.#eventSnapshots.delete(this.#activeEventKey);
      this.#activeEventKey = undefined;
      this.#displayedSnapshot = fallbackSnapshot ?? this.#latestSnapshot ?? this.#displayedSnapshot;
    }

    return { ...presentation, snapshot: this.#displayedSnapshot };
  }

  reset() {
    this.#activeEventKey = undefined;
    this.#displayedSnapshot = undefined;
    this.#eventSnapshots.clear();
    this.#latestSnapshot = undefined;
  }
}
