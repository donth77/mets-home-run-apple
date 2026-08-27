import type { GameSnapshot } from "@apple/protocol";

export type TimelineCategory = "game" | "apple" | "system";
export type TimelineFilter = "all" | TimelineCategory;
export type TimelineKind = "home-run" | "mets-win" | "review" | "delay" | "motion" | "connection" | "diagnostic";

export interface DeviceTimelineEvent {
  id: string;
  occurredAt: string;
  category: TimelineCategory;
  kind: TimelineKind;
  title: string;
  detail: string;
  gameContext?: string;
  eventKey?: string;
  result?: "completed" | "safe-hold" | "connected" | "recorded";
}

export interface FakeManagedDevice {
  id: string;
  name: string;
  host: string;
  firmwareVersion: string;
  connection: "CONNECTED";
  operatingMode: "AUTONOMOUS_LIVE";
  transport: "FAKE_DEVICE";
  motionAdapter: "RECORDING";
  wifiNetwork: string;
  wifiSignalDbm: number;
  feedStatus: string;
  feedFreshness: string;
  power: string;
  uptime: string;
  positionMm: number;
  motionState: "HOME";
  raisedDwellMs: number;
  nextGame: string;
  snapshot: GameSnapshot;
}

export const fakeManagedDevice: FakeManagedDevice = {
  id: "apple-demo-01",
  name: "Home Run Apple",
  host: "mets-apple.local",
  firmwareVersion: "0.3.0-dev",
  connection: "CONNECTED",
  operatingMode: "AUTONOMOUS_LIVE",
  transport: "FAKE_DEVICE",
  motionAdapter: "RECORDING",
  wifiNetwork: "Home Wi-Fi",
  wifiSignalDbm: -54,
  feedStatus: "Healthy",
  feedFreshness: "Accepted patch 9 seconds ago",
  power: "12 V DC",
  uptime: "2d 14h",
  positionMm: 0,
  motionState: "HOME",
  raisedDwellMs: 30_000,
  nextGame: "Tomorrow · 7:10 PM ET",
  snapshot: {
    schemaVersion: 1,
    gamePk: 777686,
    gameNumber: 1,
    phase: "LIVE",
    label: "LIVE",
    away: { id: 144, abbreviation: "ATL", name: "Atlanta", runs: 2 },
    home: { id: 121, abbreviation: "NYM", name: "Mets", runs: 3 },
    inning: 7,
    half: "BOTTOM",
    outs: 1,
    review: "NONE",
    lastEvent: "Francisco Lindor lines a single to center field",
    atBat: {
      balls: 1,
      strikes: 1,
      bases: { first: true, second: false, third: false },
      batter: "Juan Soto",
      batterLine: "2–3 · HR",
      pitcher: "Strider",
      pitchCount: 74,
    },
    linescore: {
      innings: [
        { inning: 1, away: 0, home: 0 },
        { inning: 2, away: 1, home: 0 },
        { inning: 3, away: 0, home: 0 },
        { inning: 4, away: 1, home: 0 },
        { inning: 5, away: 0, home: 1 },
        { inning: 6, away: 0, home: 0 },
        { inning: 7, away: 0, home: 2 },
      ],
      awayHits: 6,
      homeHits: 7,
      awayErrors: 0,
      homeErrors: 0,
    },
  },
};

export const fakeDeviceTimeline: readonly DeviceTimelineEvent[] = [
  {
    id: "event-hr-47",
    occurredAt: "2026-08-26T21:18:42-04:00",
    category: "game",
    kind: "home-run",
    title: "Juan Soto · Home run",
    detail: "Confirmed play persisted before the Apple sequence completed successfully.",
    gameContext: "BOT 7 · NYM 3, ATL 2",
    eventKey: "777686:play-47",
    result: "completed",
  },
  {
    id: "event-motion-47",
    occurredAt: "2026-08-26T21:19:16-04:00",
    category: "apple",
    kind: "motion",
    title: "Apple returned home",
    detail: "Raise, 30-second hold, and retract sequence finished at the home limit.",
    gameContext: "50 mm stroke · 30 s raised",
    eventKey: "777686:play-47",
    result: "completed",
  },
  {
    id: "event-review-42",
    occurredAt: "2026-08-26T20:51:03-04:00",
    category: "game",
    kind: "review",
    title: "Review overturned",
    detail: "The candidate play was discarded and the Apple remained safely retracted.",
    gameContext: "TOP 6 · NYM 1, ATL 2",
    eventKey: "777686:play-42",
    result: "safe-hold",
  },
  {
    id: "event-delay-resume",
    occurredAt: "2026-08-26T19:47:19-04:00",
    category: "game",
    kind: "delay",
    title: "Game resumed",
    detail: "Official game status returned to live after a rain delay.",
    gameContext: "BOT 3 · NYM 0, ATL 1",
  },
  {
    id: "event-win-previous",
    occurredAt: "2026-08-25T22:41:08-04:00",
    category: "game",
    kind: "mets-win",
    title: "Mets win",
    detail: "Final state persisted and the victory Apple sequence completed.",
    gameContext: "FINAL · NYM 4, PHI 3",
    eventKey: "777221:final",
    result: "completed",
  },
  {
    id: "event-connected",
    occurredAt: "2026-08-25T18:03:14-04:00",
    category: "system",
    kind: "connection",
    title: "Live feed connected",
    detail: "Schedule and incremental game-feed transport initialized successfully.",
    result: "connected",
  },
];

export function eventsForFilter(events: readonly DeviceTimelineEvent[], filter: TimelineFilter) {
  return filter === "all" ? events : events.filter((event) => event.category === filter);
}

export function createRecordedDiagnosticEvent(action: string, occurredAt: string): DeviceTimelineEvent {
  return {
    id: `diagnostic-${occurredAt}-${action}`,
    occurredAt,
    category: "system",
    kind: "diagnostic",
    title: action,
    detail: "Command recorded by the fake device adapter. No physical output was available.",
    result: "recorded",
  };
}
