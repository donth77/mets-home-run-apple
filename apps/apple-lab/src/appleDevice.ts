import { parseAppleSnapshot } from "./appleSnapshot";
import type { DeviceCardIcon, DeviceCardScreen } from "@apple/device-display-wasm";
import type { GameSnapshot } from "@apple/protocol";
import type { DeviceTimelineEvent, ManagedDevice } from "./fakeDevice";

// The physical Apple's /api/status, reduced to what the Lab renders. Parsing is
// tolerant: a newer firmware may add fields, and a missing block should never
// take the whole Lab down.

export interface AppleGame {
  gamePk: number;
  gameNumber: number;
  away: string;
  home: string;
  scheduled: string;
  state: string;
}

export interface AppleTrack {
  file: string;
  title: string;
  bytes: number;
  hr: boolean;
  win: boolean;
}

export interface AppleStatus {
  mode: string;
  firmwareVersion: string;
  firmwareSlot: string;
  hostname: string;
  motion: string;
  settings: {
    raisedSeconds: number;
    motor: boolean;
    follow: boolean;
    requireCode: boolean;
    winFullTrack: boolean;
  };
  audio: {
    card: boolean;
    playing: string;
    batter: string;
    tracks: AppleTrack[];
  };
  update: { state: string; version: string; error: string };
  lastCelebration: { kind: string; subject: string; at: number; moved: boolean } | null;
  wifi: { state: string; ssid: string; rssi: number; ip: string; configured: boolean };
  clock: boolean;
  heapFree: number;
  heapLargest: number;
  psramFree: number;
  game: AppleGame | null;
  snapshot: GameSnapshot | null;
  poll: { ok: number; failed: number; lastMs: number; nextInMs: number; lastError: string };
  sequence: string;
  fault: boolean | null;
  motionKnown: boolean;
  fixture: { version: number; scenarioId: string; state: string; frame: number; totalFrames: number };
  maintenance: { supported: boolean; pending: boolean; armed: boolean; remainingMs: number };
  drive: string;
  positionMm: number | null;
  // What the panel is showing right now. Card screens carry their text so the
  // Lab can paint the identical card; older firmware reports null.
  screen: AppleScreen | null;
}

export type AppleScreenState =
  | "WAITING"
  | "GAME"
  | "UPCOMING"
  | "OFFSEASON"
  | "DELAY"
  | "RAIN_DELAY"
  | "REVIEW"
  | "SUSPENDED"
  | "POSTPONED"
  | "CANCELLED"
  | "FINAL"
  | "SETUP"
  | "INFO"
  | "SETUP_QR"
  | "CELEBRATION";

export interface AppleScreen {
  state: AppleScreenState;
  title: string;
  status: string;
  note: string;
  accent: number;
  statusColor: number;
  icon: DeviceCardIcon;
}

const CARD_ICONS: readonly DeviceCardIcon[] = ["NONE", "ALERT", "UPDATE", "WIFI", "WIFI_LOST", "CLOCK"];

/** The renderer's card model for a status screen that is a card, else null. */
export function cardFor(screen: AppleScreen | null): DeviceCardScreen | null {
  if (!screen || (screen.state !== "WAITING" && screen.state !== "INFO")) return null;
  return {
    kind: screen.state,
    title: screen.title,
    status: screen.status,
    note: screen.note,
    accent: screen.accent,
    statusColor: screen.statusColor,
    icon: screen.icon,
  };
}

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function flag(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseAppleStatus(value: unknown): AppleStatus {
  const root = record(value);
  if (root.type !== "status") throw new Error("not an Apple status frame");
  const settings = record(root.settings);
  const audio = record(root.audio);
  const update = record(root.update);
  const wifi = record(root.wifi);
  const poll = record(root.poll);
  const game = root.game === null || root.game === undefined ? null : record(root.game);
  const last =
    root.lastCelebration === null || root.lastCelebration === undefined ? null : record(root.lastCelebration);
  const maintenance = record(root.maintenance);
  const fixture = record(root.fixture);
  const screenBlock = root.screen === null || root.screen === undefined ? null : record(root.screen);
  const motionKnown =
    typeof root.sequence === "string" &&
    ["IDLE", "LEAD_IN", "REVIEW_HOLD", "EXTENDING", "RAISED", "RETRACTING", "FAULT"].includes(root.sequence) &&
    typeof root.fault === "boolean" &&
    ["OFF", "EXTEND", "RETRACT"].includes(String(root.drive)) &&
    typeof root.positionMm === "number" &&
    Number.isFinite(root.positionMm) &&
    root.positionMm >= 0;
  const tracks = Array.isArray(audio.tracks) ? audio.tracks.map(record) : [];
  return {
    mode: text(root.mode, "UNKNOWN"),
    firmwareVersion: text(root.firmwareVersion, "?"),
    firmwareSlot: text(root.firmwareSlot, "?"),
    hostname: text(root.hostname, "home-run-apple"),
    motion: text(root.motion, "?"),
    settings: {
      raisedSeconds: number(settings.raisedSeconds, 30),
      motor: flag(settings.motor),
      follow: flag(settings.follow, true),
      requireCode: flag(settings.requireCode),
      winFullTrack: flag(settings.winFullTrack),
    },
    audio: {
      card: flag(audio.card),
      playing: text(audio.playing),
      batter: text(audio.batter),
      tracks: tracks.map((track) => ({
        file: text(track.file),
        title: text(track.title),
        bytes: number(track.bytes),
        hr: flag(track.hr),
        win: flag(track.win),
      })),
    },
    update: { state: text(update.state, "IDLE"), version: text(update.version), error: text(update.error) },
    lastCelebration:
      last === null
        ? null
        : { kind: text(last.kind), subject: text(last.subject), at: number(last.at), moved: flag(last.moved) },
    wifi: {
      state: text(wifi.state, "UNKNOWN"),
      ssid: text(wifi.ssid),
      rssi: number(wifi.rssi, -100),
      ip: text(wifi.ip),
      configured: flag(wifi.configured),
    },
    clock: flag(root.clock),
    heapFree: number(root.heapFree),
    heapLargest: number(root.heapLargest),
    psramFree: number(root.psramFree),
    game:
      game === null
        ? null
        : {
            gamePk: number(game.gamePk),
            gameNumber: number(game.gameNumber, 1),
            away: text(game.away, "---"),
            home: text(game.home, "---"),
            scheduled: text(game.scheduled),
            state: text(game.state),
          },
    // The firmware projects the same protocol snapshot the Lab's scoreboard
    // renders; anything without both teams is treated as "no live game".
    snapshot: parseAppleSnapshot(root.snapshot),
    poll: {
      ok: number(poll.ok),
      failed: number(poll.failed),
      lastMs: number(poll.lastMs),
      nextInMs: number(poll.nextInMs),
      lastError: text(poll.lastError),
    },
    sequence: text(root.sequence, "UNKNOWN"),
    fault: typeof root.fault === "boolean" ? root.fault : null,
    drive: text(root.drive, "UNKNOWN"),
    positionMm:
      typeof root.positionMm === "number" && Number.isFinite(root.positionMm) && root.positionMm >= 0
        ? root.positionMm
        : null,
    motionKnown,
    fixture: {
      version: number(fixture.version),
      scenarioId: text(fixture.scenarioId),
      state: text(fixture.state, "UNKNOWN"),
      frame: number(fixture.frame),
      totalFrames: number(fixture.totalFrames),
    },
    maintenance: {
      supported: maintenance.supported === true,
      pending: maintenance.pending === true,
      armed: maintenance.armed === true,
      remainingMs: Math.max(0, Math.min(60000, number(maintenance.remainingMs))),
    },
    screen:
      screenBlock === null
        ? null
        : {
            state: text(screenBlock.state, "WAITING") as AppleScreenState,
            title: text(screenBlock.title),
            status: text(screenBlock.status),
            note: text(screenBlock.note),
            accent: number(screenBlock.accent, 0xfac2) & 0xffff,
            statusColor: number(screenBlock.statusColor, 0xffff) & 0xffff,
            icon: CARD_ICONS[Math.min(CARD_ICONS.length - 1, Math.max(0, number(screenBlock.icon)))],
          },
  };
}

export function appleIsIdle(status: AppleStatus): boolean {
  return (
    status.mode !== "REPLAY" &&
    status.fixture.state !== "RUNNING" &&
    status.motionKnown &&
    status.sequence === "IDLE" &&
    status.fault === false &&
    status.drive === "OFF" &&
    status.positionMm === 0
  );
}

const SEQUENCE_LABELS: Record<string, string> = {
  IDLE: "Home",
  LEAD_IN: "Cueing audio",
  EXTENDING: "Raising",
  RAISED: "Raised",
  RETRACTING: "Lowering",
};

export function describeSequence(sequence: string, fault: boolean | null): string {
  if (fault === null || sequence === "UNKNOWN") return "Unknown";
  if (fault) return "Fault";
  return SEQUENCE_LABELS[sequence] ?? sequence.charAt(0) + sequence.slice(1).toLowerCase().replace(/_/g, " ");
}

export function sequenceTone(sequence: string, fault: boolean | null): "safe" | "live" | "warning" {
  if (fault !== false || sequence === "UNKNOWN") return "warning";
  return sequence === "IDLE" ? "safe" : "live";
}

export function describeRssi(rssi: number): string {
  if (rssi >= -60) return "Strong";
  if (rssi >= -70) return "Good";
  if (rssi >= -80) return "Weak";
  return "Very weak";
}

export function describeNextGame(game: AppleGame | null, mode: string, now = new Date(), timeZone?: string): string {
  if (game === null) return mode === "OFFSEASON" ? "Offseason" : "No game scheduled";
  const start = new Date(game.scheduled);
  const matchup = `${game.away} @ ${game.home}${game.gameNumber > 1 ? ` · G${game.gameNumber}` : ""}`;
  if (Number.isNaN(start.getTime())) return matchup;
  const options: Intl.DateTimeFormatOptions = timeZone ? { timeZone } : {};
  const sameDay =
    start.toLocaleDateString(undefined, { ...options, dateStyle: "medium" }) ===
    now.toLocaleDateString(undefined, { ...options, dateStyle: "medium" });
  const time = start.toLocaleTimeString(undefined, { ...options, hour: "numeric", minute: "2-digit" });
  const day = sameDay
    ? "Today"
    : start.toLocaleDateString(undefined, { ...options, weekday: "short", month: "short", day: "numeric" });
  return `${matchup} · ${day} · ${time}`;
}

export function toManagedDevice(status: AppleStatus, host: string, transport: "WIFI" | "USB" = "WIFI"): ManagedDevice {
  const feedError = status.poll.lastError.length > 0;
  return {
    id: status.hostname,
    name: "Home Run Apple",
    host,
    firmwareVersion: status.firmwareVersion,
    connection: "CONNECTED",
    operatingMode: status.mode,
    transport,
    motionAdapter: status.motion,
    wifiNetwork: status.wifi.ssid || status.wifi.state,
    wifiSignalDbm: status.wifi.rssi,
    feedStatus: feedError
      ? "Errors"
      : status.snapshot
        ? "Live"
        : status.clock
          ? "Waiting for a game"
          : "Waiting for clock",
    feedFreshness: feedError
      ? `Last error: ${status.poll.lastError}`
      : status.poll.ok > 0
        ? `${status.poll.ok} polls ok · ${status.poll.failed} failed`
        : "No live poll yet",
    power: status.settings.motor ? "Motor enabled" : "Motor disabled",
    uptime: status.clock ? "Clock synced" : "Clock not synced",
    positionMm: status.positionMm,
    motionState: status.motionKnown ? describeSequence(status.sequence, status.fault).toUpperCase() : "UNKNOWN",
    raisedDwellMs: status.settings.raisedSeconds * 1000,
    nextGame: describeNextGame(status.game, status.mode),
    snapshot: status.snapshot,
  };
}

// Timeline entries the Lab can honestly claim from watching status frames go
// by. Everything else stays on the Apple.
export function deriveTransitionEvents(
  previous: AppleStatus | null,
  next: AppleStatus,
  occurredAt: string,
): DeviceTimelineEvent[] {
  if (previous === null || !previous.motionKnown || !next.motionKnown) return [];
  const events: DeviceTimelineEvent[] = [];
  const wasIdle = previous.sequence === "IDLE";
  const isIdle = next.sequence === "IDLE";
  if (wasIdle && !isIdle) {
    const track = next.audio.playing ? ` · ${next.audio.playing.replace(/^\//, "")}` : "";
    events.push({
      id: `apple-start-${occurredAt}`,
      occurredAt,
      category: "apple",
      kind: "motion",
      title: "Apple sequence started",
      detail: `${describeSequence(next.sequence, next.fault)}${track}`,
      gameContext: next.audio.batter || undefined,
    });
  }
  if (!wasIdle && appleIsIdle(next)) {
    events.push({
      id: `apple-home-${occurredAt}`,
      occurredAt,
      category: "apple",
      kind: "motion",
      title: "Apple returned home",
      detail: `Sequence finished at ${next.positionMm} mm.`,
      result: "completed",
    });
  }
  if (!previous.fault && next.fault) {
    events.push({
      id: `apple-fault-${occurredAt}`,
      occurredAt,
      category: "system",
      kind: "diagnostic",
      title: "Apple reported a fault",
      detail: `Drive ${next.drive} · sequence ${next.sequence}. The Apple has disabled its own motion.`,
      result: "safe-hold",
    });
  }
  if (previous.wifi.state === "CONNECTED" && next.wifi.state !== "CONNECTED") {
    events.push({
      id: `apple-wifi-${occurredAt}`,
      occurredAt,
      category: "system",
      kind: "connection",
      title: "Apple lost Wi-Fi",
      detail: `Reported state ${next.wifi.state}.`,
    });
  }
  return events;
}
