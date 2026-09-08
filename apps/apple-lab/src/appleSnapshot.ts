import type { GameSnapshot } from "@apple/protocol";

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const optionalText = (v: unknown) => v === undefined || typeof v === "string";
const optionalInteger = (v: unknown) => v === undefined || integer(v);

// Only validates the shared presentation schema. It never reconstructs game
// state or derives review/celebration rules from a partial device response.
export function parseAppleSnapshot(value: unknown): GameSnapshot | null {
  if (!object(value)) return null;
  const s = value;
  if (
    s.schemaVersion !== 1 ||
    !integer(s.gamePk, 1) ||
    !integer(s.gameNumber, 1, 2) ||
    typeof s.phase !== "string" ||
    !["PREGAME", "LIVE", "REVIEW", "DELAYED", "FINAL", "SLEEP"].includes(s.phase) ||
    typeof s.half !== "string" ||
    !["TOP", "BOTTOM", "MIDDLE", "END"].includes(s.half) ||
    typeof s.review !== "string" ||
    !["NONE", "PENDING", "CONFIRMED", "OVERTURNED"].includes(s.review) ||
    typeof s.label !== "string" ||
    typeof s.lastEvent !== "string" ||
    !integer(s.inning) ||
    !integer(s.outs, 0, 3) ||
    !optionalText(s.scheduledStart) ||
    !optionalText(s.venue)
  )
    return null;
  for (const t of [s.away, s.home]) {
    if (
      !object(t) ||
      typeof t.abbreviation !== "string" ||
      typeof t.name !== "string" ||
      !integer(t.runs) ||
      !optionalInteger(t.id)
    )
      return null;
  }
  if (s.atBat !== undefined) {
    const a = s.atBat;
    if (
      !object(a) ||
      !integer(a.balls, 0, 3) ||
      !integer(a.strikes, 0, 2) ||
      !object(a.bases) ||
      [a.bases.first, a.bases.second, a.bases.third].some((v) => typeof v !== "boolean") ||
      !optionalText(a.batter) ||
      !optionalText(a.batterLine) ||
      !optionalText(a.pitcher) ||
      !optionalInteger(a.pitchCount)
    )
      return null;
  }
  if (s.linescore !== undefined) {
    const l = s.linescore;
    if (
      !object(l) ||
      !Array.isArray(l.innings) ||
      [l.awayHits, l.homeHits, l.awayErrors, l.homeErrors].some((v) => !optionalInteger(v))
    )
      return null;
    for (const i of l.innings) {
      if (
        !object(i) ||
        !integer(i.inning, 1) ||
        (i.away !== null && !integer(i.away)) ||
        (i.home !== null && !integer(i.home))
      )
        return null;
    }
  }
  return s as unknown as GameSnapshot;
}
