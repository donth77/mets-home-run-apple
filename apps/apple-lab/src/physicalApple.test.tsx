/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import snapshot from "../../../firmware/test/native/fixtures/status-snapshot.json";
import { parseAppleStatus, toManagedDevice } from "./appleDevice";
import type { AppleDeviceState } from "./useAppleDevice";
import { useUsbBenchDevice } from "./useUsbBenchDevice";
import { useUsbAppleDevice } from "./useUsbAppleDevice";
import { SimulatorWorkspace } from "./workspaces/SimulatorWorkspace";
import { LiveWorkspace } from "./workspaces/LiveWorkspace";

const status = parseAppleStatus({
  type: "status",
  mode: "LIVE",
  sequence: "IDLE",
  fault: false,
  drive: "OFF",
  positionMm: 0,
  settings: { motor: true },
  fixture: { version: 1, state: "IDLE" },
  snapshot,
  maintenance: { supported: true, armed: true, pending: false, remainingMs: 60_000 },
});
function device(overrides: Partial<AppleDeviceState> = {}): AppleDeviceState {
  return {
    connection: "CONNECTED",
    transport: "WIFI",
    host: "fixture.invalid",
    code: "",
    status,
    device: toManagedDevice(status, "fixture.invalid"),
    error: null,
    lastSeenAt: "2026-09-08T12:00:00Z",
    events: [],
    pending: null,
    idle: true,
    canTest: false,
    queued: null,
    cancelQueued: vi.fn(),
    maintenancePending: false,
    canStopTest: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    requestTestSession: vi.fn(),
    testCelebration: vi.fn(),
    runFixture: vi.fn(),
    stopFixture: vi.fn(),
    disarmTest: vi.fn(),
    ...overrides,
  };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "serial", { configurable: true, value: undefined });
});

describe("Simulator physical Apple controls", () => {
  it("requires enabling physical mode and approval before running the selected fixture", () => {
    const apple = device();
    const view = render(<SimulatorWorkspace apple={apple} />);
    const toggle = screen.getByRole("switch", { name: "Physical Apple" });
    const run = screen.getByRole("button", { name: "Run fixture on device" });
    expect(run.hasAttribute("disabled")).toBe(true);
    fireEvent.click(toggle);
    expect(apple.runFixture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Home run/ }));
    // One click asks the Apple for approval; the hook queues the run itself.
    expect(run.hasAttribute("disabled")).toBe(false);
    fireEvent.click(run);
    expect(apple.runFixture).toHaveBeenCalledWith("home-run");
    // While the Apple waits for the owner button the same button reads as a cancel.
    view.rerender(<SimulatorWorkspace apple={{ ...apple, queued: "home-run" }} />);
    const waiting = screen.getByRole("button", { name: /Waiting for the button/ });
    fireEvent.click(waiting);
    expect(apple.cancelQueued).toHaveBeenCalledOnce();
    view.rerender(<SimulatorWorkspace apple={{ ...apple, canTest: true }} />);
    expect(screen.getByRole("button", { name: "Step frame" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("slider", { name: "Manual position override" }).hasAttribute("disabled")).toBe(true);
    // Stop permission is retained even before the next status poll reports RUNNING.
    view.rerender(<SimulatorWorkspace apple={{ ...apple, canStopTest: true, pending: "home-run" }} />);
    expect(toggle.hasAttribute("disabled")).toBe(false);
    fireEvent.click(toggle);
    expect(apple.disarmTest).toHaveBeenCalledOnce();
    expect(apple.stopFixture).toHaveBeenCalledOnce();
  });

  it("keeps runs unavailable on old firmware and through production USB", () => {
    const apple = device({ canTest: true, transport: "USB" });
    render(<SimulatorWorkspace apple={apple} />);
    fireEvent.click(screen.getByRole("switch", { name: "Physical Apple" }));
    expect(screen.getByRole("button", { name: "Run fixture on device" }).hasAttribute("disabled")).toBe(true);
    expect(apple.runFixture).not.toHaveBeenCalled();
  });

  it("uses the firmware snapshot and observed events in Live Game", () => {
    const { container } = render(<LiveWorkspace apple={device()} events={[]} />);
    expect(screen.getByRole("heading", { name: "On the Apple's screen" })).toBeTruthy();
    expect(container.querySelector(".apple-scorebug")).not.toBeNull();
    expect(screen.queryByText("Juan Soto · Home run")).toBeNull();
  });
});

describe("production USB telemetry", () => {
  it("recognizes split APPLE_LIVE frames, polls status, redacts setup keys, and blocks commissioning commands", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setInterval", "clearInterval"] });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const writes: string[] = [];
    let reader!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const port = {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          reader = controller;
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          writes.push(new TextDecoder().decode(chunk).trim());
        },
      }),
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(navigator, "serial", { configurable: true, value: { requestPort: async () => port } });
    const { result } = renderHook(() => {
      const usb = useUsbBenchDevice();
      return { usb, apple: useUsbAppleDevice(usb) };
    });
    await act(async () => {
      await result.current.usb.connect();
    });
    await act(async () => {
      reader.enqueue(encoder.encode('APPLE_LIVE:{"type":"hello","setupKey":"fixture-only"}\nAPPLE_LI'));
      reader.enqueue(encoder.encode(`VE:${JSON.stringify({ ...status, type: "status" })}\n`));
    });
    expect(result.current.usb.production).toBe(true);
    expect(result.current.apple.connection).toBe("CONNECTED");
    expect(result.current.apple.status?.snapshot?.atBat?.batter).toBe("Fixture Batter");
    expect(result.current.apple.canTest).toBe(false);
    expect(result.current.usb.log.map((line) => line.text).join("\n")).not.toContain("fixture-only");
    await expect(result.current.usb.runLogicSelfTest()).rejects.toThrow(/read-only/);
    await expect(result.current.usb.jogExtend()).rejects.toThrow(/read-only/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.every((command) => command === "?")).toBe(true);
    expect(result.current.apple.connection).toBe("STALE");
    await act(async () => {
      await result.current.usb.disconnect();
    });
    expect(result.current.apple.status).toBeNull();
    expect(result.current.apple.connection).toBe("DISCONNECTED");
    expect(port.close).toHaveBeenCalledOnce();
  });
});
