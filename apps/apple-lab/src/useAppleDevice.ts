import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CelebrationKind,
  DEFAULT_APPLE_HOST,
  describeAppleError,
  fetchAppleStatus,
  requestAppleCelebration,
} from "./appleClient";
import { type AppleStatus, appleIsIdle, deriveTransitionEvents, toManagedDevice } from "./appleDevice";
import type { DeviceTimelineEvent, ManagedDevice } from "./fakeDevice";

// One Wi-Fi connection to the physical Apple, shared by every workspace. The
// Lab only reads status and asks for test celebrations; the Apple decides.

export type AppleConnection = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "STALE";

export interface AppleDeviceState {
  connection: AppleConnection;
  host: string;
  code: string;
  status: AppleStatus | null;
  device: ManagedDevice | null;
  error: string | null;
  lastSeenAt: string | null;
  events: readonly DeviceTimelineEvent[];
  pending: CelebrationKind | null;
  idle: boolean;
  connect: (host: string, code: string) => Promise<void>;
  disconnect: () => void;
  testCelebration: (kind: CelebrationKind) => Promise<void>;
}

const STORAGE_KEY = "apple-lab.apple-connection";
const POLL_MS = 1000;
const STALE_AFTER_FAILURES = 3;
const DROP_AFTER_FAILURES = 15;
const MAX_EVENTS = 60;

interface StoredConnection {
  host: string;
  code: string;
  autoConnect: boolean;
}

function readStored(): StoredConnection {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredConnection>;
      return {
        host: typeof parsed.host === "string" && parsed.host ? parsed.host : DEFAULT_APPLE_HOST,
        code: typeof parsed.code === "string" ? parsed.code : "",
        autoConnect: parsed.autoConnect === true,
      };
    }
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return { host: DEFAULT_APPLE_HOST, code: "", autoConnect: false };
}

function writeStored(value: StoredConnection) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Nothing to do; the session still works without persistence.
  }
}

function connectionEvent(title: string, detail: string, occurredAt: string): DeviceTimelineEvent {
  return {
    id: `apple-link-${occurredAt}-${title}`,
    occurredAt,
    category: "system",
    kind: "connection",
    title,
    detail,
    result: "connected",
  };
}

export function useAppleDevice(): AppleDeviceState {
  const stored = useMemo(readStored, []);
  const [host, setHost] = useState(stored.host);
  const [code, setCode] = useState(stored.code);
  const [connection, setConnection] = useState<AppleConnection>("DISCONNECTED");
  const [status, setStatus] = useState<AppleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [events, setEvents] = useState<DeviceTimelineEvent[]>([]);
  const [pending, setPending] = useState<CelebrationKind | null>(null);
  const failures = useRef(0);
  const previous = useRef<AppleStatus | null>(null);
  const timer = useRef<number | null>(null);
  const active = useRef(false);
  const inFlight = useRef(false);
  const credentials = useRef({ host: stored.host, code: stored.code });

  const pushEvents = useCallback((added: DeviceTimelineEvent[]) => {
    if (added.length === 0) return;
    setEvents((current) => [...added, ...current].slice(0, MAX_EVENTS));
  }, []);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    // One request at a time: during a celebration the Apple answers slowly,
    // and stacking polls on a weak link only makes it slower.
    if (!active.current || inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;
    try {
      const next = await fetchAppleStatus(credentials.current);
      if (!active.current) return;
      const now = new Date().toISOString();
      failures.current = 0;
      pushEvents(deriveTransitionEvents(previous.current, next, now));
      previous.current = next;
      setStatus(next);
      setLastSeenAt(now);
      setError(null);
      setConnection("CONNECTED");
    } catch (caught) {
      if (!active.current) return;
      failures.current += 1;
      if (failures.current >= DROP_AFTER_FAILURES) {
        active.current = false;
        stopPolling();
        setConnection("DISCONNECTED");
        setError(`Lost the Apple: ${describeAppleError(caught)}`);
        pushEvents([connectionEvent("Apple connection dropped", describeAppleError(caught), new Date().toISOString())]);
      } else if (failures.current >= STALE_AFTER_FAILURES) {
        setConnection("STALE");
        setError(describeAppleError(caught));
      }
    } finally {
      inFlight.current = false;
    }
  }, [pushEvents, stopPolling]);

  const disconnect = useCallback(() => {
    active.current = false;
    stopPolling();
    previous.current = null;
    setConnection("DISCONNECTED");
    setStatus(null);
    setPending(null);
    setError(null);
    writeStored({ ...credentials.current, autoConnect: false });
  }, [stopPolling]);

  const connect = useCallback(
    async (nextHost: string, nextCode: string) => {
      const cleanHost = nextHost.trim() || DEFAULT_APPLE_HOST;
      credentials.current = { host: cleanHost, code: nextCode.trim() };
      setHost(cleanHost);
      setCode(nextCode.trim());
      stopPolling();
      failures.current = 0;
      previous.current = null;
      setError(null);
      setConnection("CONNECTING");
      try {
        const first = await fetchAppleStatus(credentials.current);
        const now = new Date().toISOString();
        previous.current = first;
        setStatus(first);
        setLastSeenAt(now);
        setConnection("CONNECTED");
        active.current = true;
        writeStored({ ...credentials.current, autoConnect: true });
        pushEvents([
          connectionEvent(
            "Apple connected over Wi-Fi",
            `${cleanHost} · firmware ${first.firmwareVersion} on ${first.firmwareSlot} · ${first.wifi.rssi} dBm`,
            now,
          ),
        ]);
        timer.current = window.setInterval(() => {
          void poll();
        }, POLL_MS);
      } catch (caught) {
        active.current = false;
        setConnection("DISCONNECTED");
        setError(describeAppleError(caught));
      }
    },
    [poll, pushEvents, stopPolling],
  );

  const testCelebration = useCallback(
    async (kind: CelebrationKind) => {
      if (!active.current) return;
      setPending(kind);
      setError(null);
      try {
        await requestAppleCelebration(credentials.current, kind);
        pushEvents([
          {
            id: `apple-test-${Date.now()}`,
            occurredAt: new Date().toISOString(),
            category: "apple",
            kind: kind === "win" ? "mets-win" : "home-run",
            title: kind === "win" ? "Test Mets win requested" : "Test home run requested",
            detail: "Apple Lab asked the Apple to replay its recorded game. The Apple runs the sequence itself.",
            result: "recorded",
          },
        ]);
        void poll();
      } catch (caught) {
        setError(describeAppleError(caught));
      } finally {
        setPending(null);
      }
    },
    [poll, pushEvents],
  );

  // Auto-reconnect to the last Apple, and pause the poll while the tab is
  // hidden so a background Lab does not hammer a weak Wi-Fi link.
  useEffect(() => {
    if (stored.autoConnect && stored.code) void connect(stored.host, stored.code);
    const onVisible = () => {
      if (document.visibilityState === "visible" && active.current) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      active.current = false;
      stopPolling();
    };
    // Mount-only: the stored connection is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const device = useMemo(() => (status ? toManagedDevice(status, host) : null), [status, host]);
  const idle = status !== null && connection !== "DISCONNECTED" && appleIsIdle(status);

  return {
    connection,
    host,
    code,
    status,
    device,
    error,
    lastSeenAt,
    events,
    pending,
    idle,
    connect,
    disconnect,
    testCelebration,
  };
}
