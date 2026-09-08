import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CelebrationKind,
  DEFAULT_APPLE_HOST,
  describeAppleError,
  fetchAppleStatus,
  requestAppleCelebration,
  requestMaintenance,
  requestFixture,
  stopFixture,
  type AppleClientOptions,
} from "./appleClient";
import { type AppleStatus, appleIsIdle, deriveTransitionEvents, toManagedDevice } from "./appleDevice";
import type { DeviceTimelineEvent, ManagedDevice } from "./fakeDevice";

export type AppleConnection = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "STALE";
export interface AppleDeviceState {
  connection: AppleConnection;
  transport: "WIFI" | "USB";
  host: string;
  code: string;
  status: AppleStatus | null;
  device: ManagedDevice | null;
  error: string | null;
  lastSeenAt: string | null;
  events: readonly DeviceTimelineEvent[];
  pending: string | null;
  // A test that is waiting for the owner button: requested, not yet approved.
  // It runs by itself the moment the Apple reports the tap.
  queued: string | null;
  cancelQueued: () => void;
  idle: boolean;
  canTest: boolean;
  maintenancePending: boolean;
  canStopTest: boolean;
  disarmTest: () => void;
  connect: (host: string, code: string) => Promise<void>;
  disconnect: () => void;
  requestTestSession: () => Promise<void>;
  testCelebration: (kind: CelebrationKind) => Promise<void>;
  runFixture: (scenarioId: string) => Promise<void>;
  stopFixture: () => Promise<void>;
}

const STORAGE_KEY = "apple-lab.apple-connection";
export const STATUS_FRESH_MS = 3000;
const isVisible = () => document.visibilityState !== "hidden";
interface StoredConnection {
  host: string;
  code: string;
  autoConnect: boolean;
}
function readStored(): StoredConnection {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (value && typeof value === "object")
      return {
        host: typeof value.host === "string" && value.host ? value.host : DEFAULT_APPLE_HOST,
        code: typeof value.code === "string" ? value.code : "",
        autoConnect: value.autoConnect === true,
      };
  } catch {
    /* Storage is optional. */
  }
  return { host: DEFAULT_APPLE_HOST, code: "", autoConnect: false };
}
function store(value: StoredConnection) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* Storage is optional. */
  }
}

// An Apple the workspaces can render live: linked, with a status and a
// device model. Narrows both fields so callers need no assertions.
export type LiveApple = AppleDeviceState & { status: AppleStatus; device: ManagedDevice };
export function liveApple(apple: AppleDeviceState | undefined): LiveApple | null {
  if (!apple || apple.connection === "DISCONNECTED" || apple.status === null || apple.device === null) return null;
  return apple as LiveApple;
}

export function useAppleDevice(): AppleDeviceState {
  const [stored] = useState(readStored);
  const [host, setHost] = useState(stored.host);
  const [code, setCode] = useState(stored.code);
  const [connection, setConnection] = useState<AppleConnection>("DISCONNECTED");
  const [status, setStatus] = useState<AppleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [events, setEvents] = useState<DeviceTimelineEvent[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [canStopTest, setCanStopTest] = useState(false);
  const credentials = useRef({ host: stored.host, code: stored.code });
  const current = useRef<AppleStatus | null>(null);
  const lastSeen = useRef(-Infinity);
  const generation = useRef(0);
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const freshness = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const actionName = useRef("");
  const token = useRef("");
  const stopToken = useRef("");
  const failures = useRef(0);
  const queuedRef = useRef<{ name: string; operation: (options: AppleClientOptions) => Promise<void>; at: number } | null>(
    null,
  );
  const runQueued = useRef<((name: string, operation: (options: AppleClientOptions) => Promise<void>) => Promise<boolean>) | null>(null);
  const clearQueued = useCallback(() => {
    queuedRef.current = null;
    setQueued(null);
  }, []);
  const clearToken = useCallback(() => {
    token.current = "";
    setSessionToken("");
  }, []);
  const cleanup = useCallback(() => {
    generation.current += 1;
    active.current = false;
    if (timer.current) clearTimeout(timer.current);
    if (freshness.current) clearTimeout(freshness.current);
    pollController.current?.abort();
    pollController.current = null;
    actionController.current?.abort();
    actionController.current = null;
    token.current = "";
    stopToken.current = "";
  }, []);

  const poll = useCallback(
    async function pollStatus(epoch: number): Promise<void> {
      if (!active.current || epoch !== generation.current || pollController.current) return;
      if (timer.current) clearTimeout(timer.current);
      if (!isVisible()) return;
      const controller = new AbortController();
      pollController.current = controller;
      const deadline = setTimeout(() => controller.abort(), 8000);
      const options = { ...credentials.current, signal: controller.signal };
      try {
        const next = await fetchAppleStatus(options);
        if (!active.current || epoch !== generation.current || controller.signal.aborted || !isVisible()) return;
        const at = new Date().toISOString();
        const added = deriveTransitionEvents(current.current, next, at);
        if (added.length) setEvents((previous) => [...added, ...previous].slice(0, 60));
        current.current = next;
        lastSeen.current = performance.now();
        failures.current = 0;
        setStatus(next);
        setLastSeenAt(at);
        setConnection("CONNECTED");
        // Action errors stay visible until another deliberate action.
        if (!actionController.current) setError((previous) => (previous?.startsWith("Connection:") ? null : previous));
        // A queued test waits here for the owner's tap. Once the Apple reports
        // the session armed, run it without another click; if the presence
        // window lapses, or the token was dropped by a stale link, let go.
        const waiting = queuedRef.current;
        if (waiting && !actionController.current) {
          const settled = performance.now() - waiting.at > 2000;
          if (!token.current) {
            clearQueued();
            setError("The connection hiccupped while waiting for the button. Click the test again.");
          } else if (next.maintenance.armed) {
            clearQueued();
            void runQueued.current?.(waiting.name, waiting.operation);
          } else if (settled && !next.maintenance.pending) {
            clearQueued();
            clearToken();
            setError("The Apple's button wasn't tapped in time. Click the test again to retry.");
          }
        }
        if (freshness.current) clearTimeout(freshness.current);
        freshness.current = setTimeout(() => {
          if (active.current && epoch === generation.current) {
            setConnection("STALE");
            clearToken();
          }
        }, STATUS_FRESH_MS);
      } catch (caught) {
        if (!active.current || epoch !== generation.current) return;
        failures.current += 1;
        setConnection("STALE");
        clearToken();
        setError(`Connection: ${describeAppleError(caught)} Retrying automatically.`);
      } finally {
        clearTimeout(deadline);
        if (pollController.current === controller) pollController.current = null;
        if (active.current && epoch === generation.current && isVisible()) {
          // The Apple's display loop and its web server share a core, and each
          // status reply costs the animation a few milliseconds. While a
          // celebration or fixture is running, poll at the slowest rate that
          // still beats the 3 s freshness rule instead of once a second.
          const busy =
            current.current !== null &&
            (current.current.sequence !== "IDLE" ||
              current.current.mode === "REPLAY" ||
              current.current.fixture.state === "RUNNING");
          const delay = failures.current
            ? Math.min(15000, 1000 * 2 ** Math.min(failures.current - 1, 4))
            : busy
              ? STATUS_FRESH_MS - 500
              : 1000;
          timer.current = setTimeout(() => void pollStatus(epoch), delay);
        }
      }
    },
    [clearToken, clearQueued],
  );

  const connect = useCallback(
    async (nextHost: string, nextCode: string) => {
      cleanup();
      clearToken();
      clearQueued();
      setCanStopTest(false);
      setPending(null);
      setStatus(null);
      setLastSeenAt(null);
      setEvents([]);
      setError(null);
      current.current = null;
      lastSeen.current = -Infinity;
      failures.current = 0;
      credentials.current = { host: nextHost.trim() || DEFAULT_APPLE_HOST, code: nextCode.trim() };
      setHost(credentials.current.host);
      setCode(credentials.current.code);
      setConnection("CONNECTING");
      store({ ...credentials.current, autoConnect: true });
      active.current = true;
      await poll(generation.current);
    },
    [cleanup, clearToken, clearQueued, poll],
  );
  const disconnect = useCallback(() => {
    cleanup();
    clearToken();
    clearQueued();
    setCanStopTest(false);
    current.current = null;
    setConnection("DISCONNECTED");
    setStatus(null);
    setPending(null);
    setError(null);
    setLastSeenAt(null);
    setEvents([]);
    store({ ...credentials.current, autoConnect: false });
  }, [cleanup, clearToken, clearQueued]);

  const runAction = useCallback(
    async (name: string, operation: (options: AppleClientOptions) => Promise<void>, consume = true) => {
      const s = current.current;
      if (actionController.current) {
        if (name !== "stop" || actionName.current === "stop") return false;
        actionController.current.abort();
      }
      if (
        !active.current ||
        (name !== "stop" &&
          (!s || performance.now() - lastSeen.current >= STATUS_FRESH_MS || !isVisible() || !appleIsIdle(s)))
      ) {
        setError("Wait for fresh, idle status from the Apple.");
        return false;
      }
      if (
        consume &&
        (!token.current || !s?.maintenance.armed || s.maintenance.remainingMs <= performance.now() - lastSeen.current)
      ) {
        setError("Tap the Apple's owner button to approve this test.");
        return false;
      }
      const epoch = generation.current;
      const controller = new AbortController();
      actionController.current = controller;
      actionName.current = name;
      const options = {
        ...credentials.current,
        maintenanceToken: name === "stop" ? stopToken.current : token.current,
        signal: controller.signal,
      };
      if (consume) {
        stopToken.current = token.current;
        setCanStopTest(name !== "hr" && name !== "win");
        clearToken();
      }
      setPending(name);
      setError(null);
      const deadline = setTimeout(() => controller.abort(), 8000);
      try {
        await operation(options);
        if (epoch !== generation.current || controller.signal.aborted) return false;
        if (name === "stop") {
          stopToken.current = "";
          setCanStopTest(false);
        }
        if (consume) {
          lastSeen.current = -Infinity;
          setConnection("STALE");
        }
        await poll(epoch);
        return true;
      } catch (caught) {
        if (epoch === generation.current && actionController.current === controller)
          setError(describeAppleError(caught));
        return false;
      } finally {
        clearTimeout(deadline);
        if (actionController.current === controller) {
          actionController.current = null;
          if (epoch === generation.current) setPending(null);
        }
      }
    },
    [clearToken, poll],
  );
  useEffect(() => {
    runQueued.current = runAction;
  }, [runAction]);
  const requestTestSession = useCallback(async () => {
    clearToken();
    await runAction(
      "maintenance",
      async (options) => {
        const epoch = generation.current;
        const value = await requestMaintenance(options);
        if (epoch === generation.current && !options.signal?.aborted) {
          token.current = value;
          setSessionToken(value);
        }
      },
      false,
    );
  }, [clearToken, runAction]);
  // One click: if the Apple is already armed, run; otherwise ask for a
  // session and queue the run for the owner's tap. Clicking again cancels.
  const armAndRun = useCallback(
    async (name: string, operation: (options: AppleClientOptions) => Promise<void>) => {
      const s = current.current;
      if (queuedRef.current) {
        clearQueued();
        clearToken();
        return;
      }
      if (!active.current || !s) {
        setError("Connect to the Apple over Wi-Fi first.");
        return;
      }
      if (!s.maintenance.supported) {
        setError("Update the Apple's firmware to run tests from Apple Lab.");
        return;
      }
      if (token.current && s.maintenance.armed) {
        await runAction(name, operation);
        return;
      }
      queuedRef.current = { name, operation, at: performance.now() };
      setQueued(name);
      clearToken();
      const requested = await runAction(
        "maintenance",
        async (options) => {
          const epoch = generation.current;
          const value = await requestMaintenance(options);
          if (epoch === generation.current && !options.signal?.aborted) {
            token.current = value;
            setSessionToken(value);
          }
        },
        false,
      );
      if (!requested) clearQueued();
    },
    [clearQueued, clearToken, runAction],
  );
  const testCelebration = useCallback(
    (kind: CelebrationKind) => armAndRun(kind, (options) => requestAppleCelebration(options, kind)),
    [armAndRun],
  );
  const runFixture = useCallback((id: string) => armAndRun(id, (options) => requestFixture(options, id)), [armAndRun]);
  const cancelQueued = useCallback(() => {
    clearQueued();
    clearToken();
  }, [clearQueued, clearToken]);
  const stop = useCallback(async () => {
    await runAction("stop", stopFixture, false);
  }, [runAction]);

  useEffect(() => {
    if (stored.autoConnect) void connect(stored.host, stored.code);
    const visibility = () => {
      if (!active.current) return;
      if (!isVisible()) {
        setConnection("STALE");
        clearToken();
      } else void poll(generation.current);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      cleanup();
    };
  }, [stored, connect, cleanup, clearToken, poll]);
  const device = useMemo(() => (status ? toManagedDevice(status, host) : null), [status, host]);
  const idle = connection === "CONNECTED" && status !== null && appleIsIdle(status);
  return {
    connection,
    transport: "WIFI",
    host,
    code,
    status,
    device,
    error,
    lastSeenAt,
    events,
    pending,
    queued,
    cancelQueued,
    idle,
    canTest:
      idle &&
      !!sessionToken &&
      status?.maintenance.armed === true &&
      status.maintenance.remainingMs > 0 &&
      pending === null,
    maintenancePending: !!sessionToken && status?.maintenance.pending === true,
    canStopTest,
    disarmTest: cancelQueued,
    connect,
    disconnect,
    requestTestSession,
    testCelebration,
    runFixture,
    stopFixture: stop,
  };
}
