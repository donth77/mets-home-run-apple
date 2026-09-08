/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppleDevice } from "./useAppleDevice";

const testToken = "a".repeat(32);
const home = {
  type: "status",
  hostname: "fixture-apple",
  mode: "UPCOMING",
  sequence: "IDLE",
  fault: false,
  drive: "OFF",
  positionMm: 0,
  settings: { motor: true },
  fixture: { version: 1, state: "IDLE" },
  maintenance: { supported: true, pending: false, armed: false, remainingMs: 0 },
};
const approved = { ...home, maintenance: { supported: true, pending: false, armed: true, remainingMs: 60_000 } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(home));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Wi-Fi connection lifecycle", () => {
  it("ignores an old response after disconnect or switching devices", async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    const { result } = renderHook(useAppleDevice);
    let connecting!: Promise<void>;
    act(() => {
      connecting = result.current.connect("first.invalid", "");
    });
    const oldSignal = fetchMock.mock.calls[0][1]?.signal;
    await act(async () => {
      await result.current.connect("second.invalid", "");
    });
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      old.resolve(Response.json({ ...home, hostname: "old-device" }));
      await connecting;
    });
    expect(result.current.status?.hostname).toBe("fixture-apple");
    act(() => result.current.disconnect());
    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.connection).toBe("DISCONNECTED");
    expect(result.current.status).toBeNull();
  });

  it("recovers after failure with bounded backoff and keeps only the last known status", async () => {
    const { result } = renderHook(useAppleDevice);
    await act(async () => {
      await result.current.connect("fixture.invalid", "");
    });
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    await advance(1_000);
    expect(result.current.connection).toBe("STALE");
    expect(result.current.status?.sequence).toBe("IDLE");
    expect(result.current.idle).toBe(false);
    await advance(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(result.current.connection).toBe("CONNECTED");
    expect(result.current.error).toBeNull();
  });

  it("expires status while a poll is hanging and never overlaps polls", async () => {
    const hanging = deferred<Response>();
    const { result } = renderHook(useAppleDevice);
    await act(async () => {
      await result.current.connect("fixture.invalid", "");
    });
    fetchMock.mockReturnValueOnce(hanging.promise);
    await advance(3_000);
    expect(result.current.connection).toBe("STALE");
    expect(result.current.idle).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.current.requestTestSession();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(6_000);
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(true);
    await act(async () => {
      hanging.resolve(Response.json(home));
    });
    expect(result.current.connection).toBe("STALE");
  });

  it("handles StrictMode cleanup and ignores an unmounted auto-connect", async () => {
    window.localStorage.setItem(
      "apple-lab.apple-connection",
      JSON.stringify({ host: "fixture.invalid", code: "", autoConnect: true }),
    );
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    const { result, unmount } = renderHook(useAppleDevice, { wrapper: StrictMode });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(result.current.connection).toBe("CONNECTED");
    unmount();
    await act(async () => {
      old.resolve(Response.json(home));
    });
    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("disarms when hidden and requires fresh status after returning", async () => {
    const { result } = renderHook(useAppleDevice);
    await act(async () => {
      await result.current.connect("fixture.invalid", "");
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await advance(10_000);
    expect(result.current.connection).toBe("STALE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.connection).toBe("CONNECTED");
  });
});

describe("physical test authorization", () => {
  it("can stop while Start is still awaiting a response", async () => {
    const starting = deferred<Response>();
    const stopping = deferred<Response>();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/api/maintenance")) return Response.json({ token: testToken });
      if (String(url).includes("/api/fixture?")) return starting.promise;
      if (String(url).endsWith("/api/fixture/stop")) return stopping.promise;
      return Response.json(approved);
    });
    const { result } = renderHook(useAppleDevice);
    await act(async () => {
      await result.current.connect("fixture.invalid", "");
      await result.current.requestTestSession();
    });
    let start!: Promise<void>;
    let stop!: Promise<void>;
    act(() => {
      start = result.current.runFixture("home-run");
    });
    expect(result.current.canStopTest).toBe(true);
    act(() => {
      stop = result.current.stopFixture();
    });
    const startCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/fixture?"));
    expect(startCall?.[1]?.signal?.aborted).toBe(true);
    await act(async () => {
      starting.resolve(Response.json({ ok: true }));
      await start;
    });
    expect(result.current.pending).toBe("stop");
    await act(async () => {
      stopping.resolve(Response.json({ ok: true }));
      await stop;
    });
    expect(result.current.pending).toBeNull();
    expect(result.current.canStopTest).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("asks for approval on the first click, runs by itself after the tap, and spends one token per run", async () => {
    let deviceStatus = home;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/api/maintenance")) return Response.json({ token: testToken });
      if (String(url).includes("/api/fixture?")) return Response.json({ ok: true });
      return Response.json(deviceStatus);
    });
    const { result } = renderHook(useAppleDevice);
    await act(async () => {
      await result.current.connect("fixture.invalid", "fixture-code");
    });
    expect(result.current.canTest).toBe(false);
    // One click: the Lab requests the session and waits for the owner button.
    await act(async () => {
      await result.current.runFixture("home-run");
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/maintenance"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/fixture?"))).toBe(false);
    expect(result.current.queued).toBe("home-run");
    expect(result.current.canTest).toBe(false);
    // The tap lands: the next status reports the session armed and the run fires alone.
    deviceStatus = approved;
    await advance(1_000);
    await advance(50);
    const starts = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/fixture?"));
    expect(starts).toHaveLength(1);
    expect(new Headers(starts[0][1]?.headers).get("X-Apple-Maintenance")).toBe(testToken);
    expect(result.current.queued).toBeNull();
    expect(result.current.canTest).toBe(false);
    expect(window.localStorage.getItem("apple-lab.apple-connection")).not.toContain(testToken);
    // The token was spent: another click asks for a new session rather than reusing it.
    deviceStatus = home;
    await act(async () => {
      await result.current.runFixture("home-run");
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/fixture?"))).toHaveLength(1);
    expect(result.current.queued).toBe("home-run");
    // Clicking again while waiting cancels the queued run.
    await act(async () => {
      await result.current.runFixture("home-run");
    });
    expect(result.current.queued).toBeNull();
    await act(async () => {
      await result.current.stopFixture();
    });
    expect(
      new Headers(fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/fixture/stop"))?.[1]?.headers).get(
        "X-Apple-Maintenance",
      ),
    ).toBe(testToken);
  });

  it("gives up on a queued run when the button window lapses", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/api/maintenance")) return Response.json({ token: testToken });
      return Response.json(home);
    });
    const { result } = renderHook(useAppleDevice);
    await act(async () => {
      await result.current.connect("fixture.invalid", "fixture-code");
    });
    await act(async () => {
      await result.current.testCelebration("hr");
    });
    expect(result.current.queued).toBe("hr");
    await advance(3_500);
    expect(result.current.queued).toBeNull();
    expect(result.current.error).toMatch(/wasn't tapped in time/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/replay"))).toBe(false);
  });

  it("refuses expired approval even between status polls", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/api/maintenance")
        ? Response.json({ token: testToken })
        : Response.json({ ...approved, maintenance: { ...approved.maintenance, remainingMs: 100 } }),
    );
    const { result } = renderHook(useAppleDevice);
    await act(async () => {
      await result.current.connect("fixture.invalid", "");
      await result.current.requestTestSession();
    });
    await advance(101);
    await act(async () => {
      await result.current.testCelebration("hr");
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/replay"))).toBe(false);
  });

  it("does not transfer a session response from an old connection", async () => {
    const session = deferred<Response>();
    const { result } = renderHook(useAppleDevice);
    await act(async () => {
      await result.current.connect("first.invalid", "");
    });
    fetchMock.mockReturnValueOnce(session.promise);
    let requesting!: Promise<void>;
    act(() => {
      requesting = result.current.requestTestSession();
    });
    await act(async () => {
      await result.current.connect("second.invalid", "");
    });
    await act(async () => {
      session.resolve(Response.json({ token: testToken }));
      await requesting;
    });
    expect(result.current.canTest).toBe(false);
    expect(result.current.pending).toBeNull();
    expect(result.current.host).toBe("second.invalid");
  });
});
