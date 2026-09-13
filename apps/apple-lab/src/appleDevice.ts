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
    // Totals from status. Newer firmware sends counts and keeps the list
    // itself behind /api/audio/library; older firmware sends the list.
    count: number;
    countHr: number;
    countWin: number;
  };
  update: { state: string; version: string; error: string };
  lastCelebration: { kind: string; subject: string; at: number; moved: boolean; outcome: string } | null;
  wifi: { state: string; ssid: string; rssi: number; ip: string; configured: boolean };
  clock: boolean;
  heapFree: number;
  heapLargest: number;
  psramFree: number;
  game: AppleGame | null;
  snapshot: GameSnapshot | null;
  poll: { ok: number; failed: number; lastMs: number; lastBytes: number; nextInMs: number; lastError: string };
  /** The schedule lookup's own health; null on firmware that reports only the feed. */
  schedule: {
    ok: number;
    failed: number;
    lastMs: number;
    lastError: string;
    checkedAgoMs: number;
    nextInMs: number;
    refreshMs: number;
    games: number;
  } | null;
  uptimeMs: number | null;
  resetReason: string | null;
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
  const sched = root.schedule === null || root.schedule === undefined ? null : record(root.schedule);
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
  const count = number(audio.count, tracks.length);
  const countHr = number(audio.countHr, tracks.filter((track) => flag(track.hr)).length);
  const countWin = number(audio.countWin, tracks.filter((track) => flag(track.win)).length);
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
      count,
      countHr,
      countWin,
    },
    update: { state: text(update.state, "IDLE"), version: text(update.version), error: text(update.error) },
    lastCelebration:
      last === null
        ? null
        : {
            kind: text(last.kind),
            subject: text(last.subject),
            at: number(last.at),
            moved: flag(last.moved),
            // Older firmware only knew whether the motor was on.
            outcome: text(last.outcome) || (flag(last.moved) ? "ROSE" : "SCREEN_ONLY"),
          },
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
      lastBytes: number(poll.lastBytes),
      nextInMs: number(poll.nextInMs),
      lastError: text(poll.lastError),
    },
    schedule: sched
      ? {
          ok: number(sched.ok),
          failed: number(sched.failed),
          lastMs: number(sched.lastMs),
          lastError: text(sched.lastError),
          checkedAgoMs: number(sched.checkedAgoMs, -1),
          nextInMs: number(sched.nextInMs),
          refreshMs: number(sched.refreshMs),
          games: number(sched.games),
        }
      : null,
    uptimeMs: typeof root.uptimeMs === "number" ? root.uptimeMs : null,
    resetReason: typeof root.resetReason === "string" ? root.resetReason : null,
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

// The Apple fetches one thing at a time: the live feed during a game, the
// schedule between games. Report whichever it is on, and only call a failure
// out while the latest attempt is the one that failed.
function describeFetching(status: AppleStatus): Pick<ManagedDevice, "feedLabel" | "feedStatus" | "feedFreshness" | "feedHealthy"> {
  const weak = status.wifi.rssi < -80 ? ` · Wi-Fi ${status.wifi.rssi} dBm` : "";
  const retries = (count: number) => (count ? ` · ${count} ${count === 1 ? "retry" : "retries"} since power-on` : "");
  const inGame = status.schedule === null || status.mode === "LIVE" || status.mode === "REPLAY" || status.snapshot !== null;
  if (inGame) {
    const error = status.poll.lastError;
    return {
      feedLabel: "Game feed",
      feedStatus: error ? "Problem" : status.snapshot ? "Live" : status.clock ? "Waiting for a game" : "Waiting for clock",
      feedFreshness: error
        ? `${error}${weak} · retrying`
        : status.poll.ok > 0
          ? `Updated ${status.poll.ok} times${retries(status.poll.failed)}`
          : "No live poll yet",
      feedHealthy: !error,
    };
  }
  const schedule = status.schedule as NonNullable<AppleStatus["schedule"]>;
  const every = schedule.refreshMs >= 3_600_000 ? "every hour" : `every ${Math.round(schedule.refreshMs / 60_000)} minutes`;
  const agoMin = Math.round(schedule.checkedAgoMs / 60_000);
  return {
    feedLabel: "Schedule",
    feedStatus: schedule.lastError
      ? "Problem"
      : schedule.ok > 0
        ? status.game
          ? "Up to date"
          : "No Mets game this week"
        : "Waiting for the schedule",
    feedFreshness: schedule.lastError
      ? `${schedule.lastError}${weak} · retrying`
      : schedule.ok > 0
        ? `Checked ${agoMin < 1 ? "just now" : `${agoMin} min ago`} · ${every}${retries(schedule.failed)}`
        : "",
    feedHealthy: !schedule.lastError,
  };
}

export function toManagedDevice(status: AppleStatus, host: string, transport: "WIFI" | "USB" = "WIFI"): ManagedDevice {
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
    ...describeFetching(status),
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
  // Each successful MLB fetch bumps the Apple's counter; the log entry says how
  // big and how slow it was, which is what explains a sluggish Apple during a
  // game. Failures come from the Apple's own log, which also names the retry.
  if (next.poll.ok > previous.poll.ok && next.game) {
    events.push({
      id: `apple-feed-ok-${next.poll.ok}`,
      occurredAt,
      category: "system",
      kind: "connection",
      title: "Live feed fetched",
      detail: `${formatBytes(next.poll.lastBytes)} in ${(next.poll.lastMs / 1000).toFixed(1)} s · ${next.poll.ok} ok · ${next.poll.failed} failed since boot`,
      gameContext: `${next.game.away} at ${next.game.home}`,
      result: "connected",
    });
  }
  if (next.uptimeMs !== null && previous.uptimeMs !== null && next.uptimeMs < previous.uptimeMs) {
    events.push({
      id: `apple-reboot-${occurredAt}`,
      occurredAt,
      category: "system",
      kind: "diagnostic",
      title: "Apple restarted",
      detail: `Reset reason ${next.resetReason ?? "unknown"} · firmware ${next.firmwareVersion} on ${next.firmwareSlot}.`,
      result: "safe-hold",
    });
  }
  return events;
}

const LIFT_OUTCOMES: Record<string, string> = {
  ROSE: "the Apple rose",
  RUNNING: "running now",
  SCREEN_ONLY: "screen only, motor off",
  STOPPED: "stopped before it rose",
  FAULT: "stopped by a motor fault",
  INTERRUPTED: "cut short by a restart",
};

/** "Home run · Juan Soto · the Apple rose" — what the last real celebration did. */
export function describeLastCelebration(last: NonNullable<AppleStatus["lastCelebration"]>): string {
  const kind = last.kind === "WIN" ? "Mets win" : "Home run";
  return `${kind} · ${last.subject} · ${LIFT_OUTCOMES[last.outcome] ?? last.outcome.toLowerCase()}`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}

/** One line of the Apple's own trace log, as served by /api/events. */
export interface AppleTrace {
  seq: number;
  /** Unix seconds, or 0 when the Apple's clock had not synced yet. */
  at: number;
  /** Apple uptime when logged, for placing entries the clock missed. */
  ms: number;
  code: string;
  detail: string;
}
export interface AppleEventLog {
  now: number;
  uptimeMs: number;
  resetReason: string;
  events: AppleTrace[];
}

export function parseAppleEventLog(value: unknown): AppleEventLog {
  const root = record(value);
  const list = Array.isArray(root.events) ? root.events : [];
  return {
    now: number(root.now),
    uptimeMs: number(root.uptimeMs),
    resetReason: text(root.resetReason),
    events: list.map((item) => {
      const entry = record(item);
      return { seq: number(entry.seq), at: number(entry.at), ms: number(entry.ms), code: text(entry.code), detail: text(entry.detail) };
    }),
  };
}

const TRACE_TITLES: Record<string, string> = {
  BOOT: "Apple booted",
  WIFI: "Wi-Fi",
  CLOCK: "Clock",
  SCHEDULE: "Schedule",
  FOLLOW: "Following a game",
  FEED: "Live feed",
  FEED_REGRESSED: "Live feed went backwards",
  FEED_RESYNC: "Live feed resynced",
  FINAL_HOLD_COMPLETE: "Final card released",
  ERROR: "Apple reported an error",
  AUDIO: "Audio",
  BACKLIGHT: "Display",
  SETTINGS: "Settings changed",
  SETUP_NETWORK: "Setup network",
  UPDATE: "Firmware update",
  RELEASE: "Release check",
  REPLAY: "Test celebration",
  CELEBRATION: "Celebration",
  RESET: "Reset button",
  SAFE_MODE: "Safe mode",
  STOPPED: "Stopped",
  MAINTENANCE_REQUIRED: "Test refused",
  COMMAND_REJECTED: "Command rejected",
};
const SAFE_HOLD_CODES = new Set(["ERROR", "SAFE_MODE", "STOPPED", "MAINTENANCE_REQUIRED", "COMMAND_REJECTED", "FEED_REGRESSED"]);

/** The Apple's log as timeline entries. `receivedAt` is when the Lab fetched it. */
export function traceEvents(log: AppleEventLog, receivedAt: string): DeviceTimelineEvent[] {
  const receivedMs = Date.parse(receivedAt);
  return log.events.map((entry) => {
    // Entries from before the clock synced are placed by uptime, counting back
    // from when this log was fetched.
    const atMs = entry.at > 0 ? entry.at * 1000 : receivedMs - Math.max(0, log.uptimeMs - entry.ms);
    const failure = SAFE_HOLD_CODES.has(entry.code) || (entry.code === "FEED" && /fail/i.test(entry.detail));
    const celebration = entry.code === "CELEBRATION" || entry.code === "REPLAY";
    return {
      id: `apple-trace-${entry.seq}`,
      occurredAt: new Date(atMs).toISOString(),
      category: celebration ? "apple" : "system",
      kind: celebration
        ? entry.detail.startsWith("win")
          ? "mets-win"
          : entry.detail.startsWith("home run")
            ? "home-run"
            : "motion"
        : entry.code === "WIFI" || entry.code === "FEED"
          ? "connection"
          : "diagnostic",
      title: TRACE_TITLES[entry.code] ?? entry.code,
      detail: entry.detail || entry.code,
      ...(failure ? { result: "safe-hold" as const } : {}),
    };
  });
}
