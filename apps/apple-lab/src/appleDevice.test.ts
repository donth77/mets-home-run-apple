import { describe, expect, it } from "vitest";
import {
  type AppleStatus,
  appleIsIdle,
  deriveTransitionEvents,
  describeNextGame,
  describeRssi,
  describeSequence,
  parseAppleEventLog,
  parseAppleStatus,
  toManagedDevice,
  traceEvents,
} from "./appleDevice";
import statusFixture from "./fixtures/apple-status.json";
import snapshotGolden from "../../../firmware/test/native/fixtures/status-snapshot.json";

const status = parseAppleStatus(statusFixture);

describe("parseAppleStatus", () => {
  it("reads a real status frame from the Apple", () => {
    expect(status.mode).toBe("UPCOMING");
    expect(status.firmwareVersion).toBe("0.3.0-rc.8");
    expect(status.firmwareSlot).toMatch(/^app[01]$/);
    expect(status.audio.card).toBe(true);
    expect(status.audio.tracks).toHaveLength(6);
    expect(status.audio.tracks.filter((track) => track.hr)).toHaveLength(4);
    expect(status.audio.tracks.filter((track) => track.win)).toHaveLength(2);
    expect(status.game).toMatchObject({ away: "NYM", home: "MIA", state: "Scheduled" });
    expect(status.snapshot).toBeNull();
    expect(status.sequence).toBe("IDLE");
    expect(status.positionMm).toBe(0);
    expect(status.wifi.rssi).toBeLessThan(0);
  });

  it("rejects frames that are not status", () => {
    expect(() => parseAppleStatus({ type: "trace", code: "AUDIO" })).toThrow(/status/);
  });

  it("tolerates missing blocks instead of crashing the Lab", () => {
    const sparse = parseAppleStatus({ type: "status", sequence: "IDLE" });
    expect(sparse.audio.tracks).toEqual([]);
    expect(sparse.game).toBeNull();
    expect(sparse.wifi.rssi).toBe(-100);
    expect(sparse.settings.raisedSeconds).toBe(30);
    expect(sparse.motionKnown).toBe(false);
    expect(sparse.fault).toBeNull();
    expect(sparse.positionMm).toBeNull();
    expect(appleIsIdle(sparse)).toBe(false);
  });

  it.each([undefined, null, "OFF", Number.NaN, -1])("never enables motion with invalid position %s", (positionMm) => {
    expect(appleIsIdle(parseAppleStatus({ ...statusFixture, positionMm }))).toBe(false);
  });

  it.each(["sequence", "drive", "fault"])("requires explicit %s telemetry", (field) => {
    const incomplete = { ...statusFixture, [field]: undefined };
    expect(appleIsIdle(parseAppleStatus(incomplete))).toBe(false);
  });

  it("renders the complete snapshot emitted by the native firmware serializer", () => {
    const parsed = parseAppleStatus({ ...statusFixture, snapshot: snapshotGolden });
    expect(parsed.snapshot?.atBat).toMatchObject({
      balls: 2,
      strikes: 1,
      batter: "Fixture Batter",
      bases: { first: true, second: false, third: true },
    });
    expect(parsed.snapshot?.linescore?.innings[1]).toEqual({ inning: 2, away: 2, home: null });
    expect(parsed.snapshot?.away.abbreviation).toBe("ATL");
    expect(parsed.snapshot?.home.abbreviation).toBe("NYM");
    expect(
      parseAppleStatus({ ...statusFixture, snapshot: { ...snapshotGolden, atBat: { balls: 4 } } }).snapshot,
    ).toBeNull();
    expect(
      parseAppleStatus({ ...statusFixture, snapshot: { gamePk: 1, awayRuns: 2, homeRuns: 3 } }).snapshot,
    ).toBeNull();
  });
});

describe("toManagedDevice", () => {
  it("fills the shape the workspaces already render", () => {
    const device = toManagedDevice(status, "home-run-apple.local");
    expect(device.transport).toBe("WIFI");
    expect(device.host).toBe("home-run-apple.local");
    expect(device.motionState).toBe("HOME");
    expect(device.raisedDwellMs).toBe(30_000);
    expect(device.motionAdapter).toBe("L298N");
    expect(device.nextGame).toMatch(/^NYM @ MIA · /);
    expect(device.snapshot).toBeNull();
  });
});

describe("descriptions", () => {
  it("names the motion sequence for people", () => {
    expect(describeSequence("IDLE", false)).toBe("Home");
    expect(describeSequence("EXTENDING", false)).toBe("Raising");
    expect(describeSequence("RAISED", false)).toBe("Raised");
    expect(describeSequence("RETRACTING", false)).toBe("Lowering");
    expect(describeSequence("LEAD_IN", false)).toBe("Cueing audio");
    expect(describeSequence("SOMETHING_NEW", false)).toBe("Something new");
    expect(describeSequence("RAISED", true)).toBe("Fault");
  });

  it("grades Wi-Fi signal", () => {
    expect(describeRssi(-55)).toBe("Strong");
    expect(describeRssi(-68)).toBe("Good");
    expect(describeRssi(-78)).toBe("Weak");
    expect(describeRssi(-88)).toBe("Very weak");
  });

  it("describes the next game relative to today", () => {
    const now = new Date("2026-09-08T15:00:00Z");
    const tonight = describeNextGame(
      { gamePk: 1, gameNumber: 1, away: "NYM", home: "MIA", scheduled: "2026-09-08T22:40:00Z", state: "Scheduled" },
      "UPCOMING",
      now,
      "America/New_York",
    );
    expect(tonight).toBe("NYM @ MIA · Today · 6:40 PM");
    const doubleheader = describeNextGame(
      { gamePk: 2, gameNumber: 2, away: "NYM", home: "MIA", scheduled: "2026-09-10T17:10:00Z", state: "Scheduled" },
      "UPCOMING",
      now,
      "America/New_York",
    );
    expect(doubleheader).toBe("NYM @ MIA · G2 · Thu, Sep 10 · 1:10 PM");
    expect(describeNextGame(null, "OFFSEASON", now)).toBe("Offseason");
    expect(describeNextGame(null, "UPCOMING", now)).toBe("No game scheduled");
  });

  it("only calls the Apple idle when it is home and clear", () => {
    expect(appleIsIdle(status)).toBe(true);
    expect(appleIsIdle({ ...status, sequence: "RAISED" })).toBe(false);
    expect(appleIsIdle({ ...status, fault: true })).toBe(false);
  });
});

describe("deriveTransitionEvents", () => {
  const at = "2026-09-08T20:00:00.000Z";
  const raised: AppleStatus = {
    ...status,
    sequence: "EXTENDING",
    audio: { ...status.audio, playing: "/hr2.wav", batter: "Francisco Lindor" },
  };

  it("reports nothing for the first frame", () => {
    expect(deriveTransitionEvents(null, status, at)).toEqual([]);
  });

  it("notes a sequence starting, with the track and batter", () => {
    const events = deriveTransitionEvents(status, raised, at);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      category: "apple",
      kind: "motion",
      title: "Apple sequence started",
      detail: "Raising · hr2.wav",
      gameContext: "Francisco Lindor",
    });
  });

  it("notes the Apple returning home", () => {
    const events = deriveTransitionEvents(raised, status, at);
    expect(events.map((event) => event.title)).toEqual(["Apple returned home"]);
    expect(events[0].result).toBe("completed");
  });

  it("flags a new fault and a lost network as system events", () => {
    const faulted = { ...raised, fault: true, wifi: { ...status.wifi, state: "LOST" } };
    const events = deriveTransitionEvents(raised, faulted, at);
    expect(events.map((event) => event.title)).toEqual(["Apple reported a fault", "Apple lost Wi-Fi"]);
    expect(events[0].result).toBe("safe-hold");
  });

  it("does not claim a home arrival while faulted", () => {
    const faultedHome = { ...status, fault: true };
    expect(deriveTransitionEvents(raised, faultedHome, at).map((event) => event.title)).toEqual([
      "Apple reported a fault",
    ]);
  });

  it("logs each live feed fetch with its size and time, and a restart", () => {
    const game = { gamePk: 1, gameNumber: 1, away: "NYM", home: "MIA", scheduled: "", state: "In Progress" };
    const before: AppleStatus = { ...status, game, uptimeMs: 500_000, poll: { ...status.poll, ok: 6, failed: 3 } };
    const after: AppleStatus = {
      ...before,
      poll: { ...before.poll, ok: 7, lastMs: 3807, lastBytes: 106_410 },
    };
    const fetched = deriveTransitionEvents(before, after, at);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toMatchObject({
      kind: "connection",
      title: "Live feed fetched",
      detail: "104 KB in 3.8 s · 7 ok · 3 failed since boot",
      gameContext: "NYM at MIA",
    });
    expect(deriveTransitionEvents(after, after, at)).toEqual([]);
    const rebooted: AppleStatus = { ...after, uptimeMs: 12_000, resetReason: "PANIC" };
    const events = deriveTransitionEvents(after, rebooted, at);
    expect(events.map((event) => event.title)).toEqual(["Apple restarted"]);
    expect(events[0].detail).toContain("PANIC");
  });
});

describe("the Apple's event log", () => {
  it("places entries the clock missed by uptime and marks failures", () => {
    const log = parseAppleEventLog({
      now: 1_788_915_600,
      uptimeMs: 60_000,
      resetReason: "BROWNOUT",
      events: [
        { seq: 1, at: 0, ms: 1_000, code: "BOOT", detail: "reset: BROWNOUT; firmware 0.3.0 on app1" },
        { seq: 2, at: 1_788_915_590, ms: 50_000, code: "FEED", detail: "live feed fetch failed after 20005 ms (2 in a row); retry in 10 s" },
        { seq: 3, at: 1_788_915_595, ms: 55_000, code: "WIFI", detail: "retrying" },
      ],
    });
    const received = "2026-09-08T00:00:00.000Z";
    const events = traceEvents(log, received);
    expect(events.map((event) => event.title)).toEqual(["Apple booted", "Live feed", "Wi-Fi"]);
    // Logged 59 s before the log was read, on a clock that had not synced.
    expect(Date.parse(events[0].occurredAt)).toBe(Date.parse(received) - 59_000);
    expect(events[1].occurredAt).toBe(new Date(1_788_915_590_000).toISOString());
    expect(events[1].result).toBe("safe-hold");
    expect(events[2].result).toBeUndefined();
    expect(events.map((event) => event.id)).toEqual(["apple-trace-1", "apple-trace-2", "apple-trace-3"]);
  });

  it("tolerates an empty or malformed log", () => {
    expect(parseAppleEventLog({}).events).toEqual([]);
    expect(traceEvents(parseAppleEventLog({ events: "no" }), "2026-09-08T00:00:00.000Z")).toEqual([]);
  });
});
