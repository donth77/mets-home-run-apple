/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  Object.defineProperty(navigator, "serial", { configurable: true, value: undefined });
});

describe("Apple Lab manager", () => {
  it("uses team nicknames in the compact engineering scoreboard", () => {
    const { container } = render(<App />);
    const teamNames = [...container.querySelectorAll(".apple-scoreboard__name")].map((node) => node.textContent);

    expect(teamNames).toContain("Braves");
    expect(teamNames).not.toContain("Atlanta");
  });

  it("opens the read-only live timeline with significant events", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Apple Lab is ready" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Live game/ }));

    expect(screen.getByRole("heading", { name: "Live game" })).toBeTruthy();
    expect(screen.getByText("Juan Soto · Home run")).toBeTruthy();
    expect(screen.getByText("Mets win")).toBeTruthy();
    expect(screen.queryByText(/Pitch 4/)).toBeNull();
  });

  it("paginates history and exports every matching row rather than only the current page", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Live game/ }));

    expect(screen.getByText("1–5 of 6")).toBeTruthy();
    const exportButton = screen.getByRole("button", { name: "Export CSV" });
    expect(exportButton.getAttribute("title")).toContain("all 6 matching rows");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect(screen.getByText("Live feed connected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "System" }));
    expect(screen.getByText("1–1 of 1")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
  });

  it("labels timeline timestamps as browser-local time", () => {
    render(<App />);
    expect(screen.getByText(/browser time$/)).toBeTruthy();
  });

  it("keeps powered tests and the USB-only session unavailable without a Nano", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Hardware tests/ }));

    expect(screen.getAllByText("Hardware disconnected").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Connect Nano" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Arm USB-only test" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("button", { name: "Unavailable" })).toHaveLength(4);
  });

  it("runs only the bounded logic self-test through an explicitly selected USB Nano", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const commands: string[] = [];
    let serialController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const port = {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          serialController = controller;
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          const command = decoder.decode(chunk).trim();
          commands.push(command);
          if (command === "?") {
            serialController?.enqueue(
              encoder.encode(
                'APPLE_BENCH:{"type":"hello","protocolVersion":1,"profile":"motor_logic_test","firmwareVersion":"0.1.0","safetyMode":"USB_LOGIC_ONLY"}\n' +
                  'APPLE_BENCH:{"type":"state","state":"STOP","ena":0,"in1":0,"in2":0}\n',
              ),
            );
          }
          if (command === "t") {
            serialController?.enqueue(
              encoder.encode(
                'APPLE_BENCH:{"type":"test","name":"motor_logic","status":"STARTED"}\n' +
                  'APPLE_BENCH:{"type":"state","state":"RAISE","ena":1,"in1":1,"in2":0}\n' +
                  'APPLE_BENCH:{"type":"state","state":"LOWER","ena":1,"in1":0,"in2":1}\n' +
                  'APPLE_BENCH:{"type":"state","state":"STOP","ena":0,"in1":0,"in2":0}\n' +
                  'APPLE_BENCH:{"type":"test","name":"motor_logic","status":"PASSED"}\n',
              ),
            );
          }
        },
      }),
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: vi.fn().mockResolvedValue(port) },
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Hardware tests/ }));
    fireEvent.click(screen.getByRole("button", { name: "Connect Nano" }));
    await waitFor(() => expect(screen.getByText("Nano recognized")).toBeTruthy());
    expect(screen.getByText("motor_logic_test")).toBeTruthy();
    expect(screen.getByText("USB_LOGIC_ONLY")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "12 V disconnected" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Actuator disconnected" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "OUT1 and OUT2 empty" }));
    fireEvent.click(screen.getByRole("button", { name: "Arm USB-only test" }));
    fireEvent.click(screen.getByRole("button", { name: "Run bounded logic self-test" }));

    await waitFor(() => expect(screen.getByText("Motor logic self-test passed")).toBeTruthy());
    expect(commands).toEqual(["?", "t"]);
    expect(commands).not.toContain("u");
    expect(commands).not.toContain("d");
  });

  function mockSerialPort(respond: (command: string) => string | undefined) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const commands: string[] = [];
    let serialController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const port = {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          serialController = controller;
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          const command = decoder.decode(chunk).trim();
          commands.push(command);
          const reply = respond(command);
          if (reply) serialController?.enqueue(encoder.encode(reply));
        },
      }),
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: vi.fn().mockResolvedValue(port) },
    });
    return commands;
  }

  it("arms and issues exactly one bounded jog per click through the actuator jog profile", async () => {
    const status = (armed: boolean, motion: string) =>
      `APPLE_JOG:{"type":"status","firmwareVersion":"0.1.0","armed":${armed},"motion":"${motion}","maxJogMs":200}\n`;
    const commands = mockSerialPort((command) => {
      if (command === "?") {
        return (
          'APPLE_JOG:{"type":"hello","profile":"actuator_jog_test","firmwareVersion":"0.1.0","maxJogMs":200,"armWindowMs":60000}\n' +
          status(false, "STOP")
        );
      }
      if (command === "a") return `ACTUATOR_JOG=ARMED AUTO_DISARM_MS=60000\n${status(true, "STOP")}`;
      if (command === "u")
        return `${status(true, "EXTEND")}${status(false, "STOP")}ACTUATOR_JOG=DISARMED\nACTUATOR_JOG=AUTO_STOP\n`;
      return undefined;
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Hardware tests/ }));
    fireEvent.click(screen.getByRole("button", { name: "Connect Nano" }));
    await waitFor(() => expect(screen.getByText("Nano recognized")).toBeTruthy());
    expect(screen.getByText("actuator_jog_test")).toBeTruthy();
    expect(screen.getByText("POWERED_JOG")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "12 V supply fused and switched" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Actuator unloaded, secured, and attended" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Travel path clear of hands, wires, and tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Arm powered session" }));
    fireEvent.click(screen.getByRole("button", { name: "Extend 200 ms" }));

    await waitFor(() => expect(screen.getByText("Actuator jog auto-stopped after 200 ms")).toBeTruthy());
    expect(commands).toEqual(["?", "a", "u"]);
  });

  it("runs one engine-driven sequence per arm through the motion commissioning profile", async () => {
    const state = (sequence: string, drive: string, armed = false) =>
      `APPLE_MOTION:{"type":"state","armed":${armed},"sequence":"${sequence}","drive":"${drive}","positionMm":0,"positionKnown":true,"fault":false,"ena":0,"in1":0,"in2":0}\n`;
    const commands = mockSerialPort((command) => {
      if (command === "?") {
        return (
          'APPLE_MOTION:{"type":"hello","profile":"motion_commissioning","firmwareVersion":"0.1.0","strokeMm":50,"extendFullMs":5500,"retractFullMs":5300,"overrunMs":1500,"deadlineMs":10000,"leadInMs":2000,"dwellMs":30000,"armWindowMs":60000}\n' +
          state("IDLE", "OFF")
        );
      }
      if (command === "a") return state("IDLE", "OFF", true);
      if (command === "h") {
        return (
          'APPLE_MOTION:{"type":"run","status":"STARTED"}\n' +
          state("LEAD_IN", "OFF") +
          state("EXTENDING", "EXTEND") +
          state("RAISED", "OFF") +
          state("RETRACTING", "RETRACT") +
          state("IDLE", "OFF") +
          'APPLE_MOTION:{"type":"run","status":"COMPLETED"}\n'
        );
      }
      return undefined;
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Hardware tests/ }));
    fireEvent.click(screen.getByRole("button", { name: "Connect Nano" }));
    await waitFor(() => expect(screen.getByText("Nano recognized")).toBeTruthy());
    expect(screen.getByText("motion_commissioning")).toBeTruthy();
    expect(screen.getByText("POWERED_SEQUENCE")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "12 V supply fused and switched" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Actuator unloaded, secured, and attended" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Travel path clear of hands, wires, and tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Arm powered session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start one home run" }));

    await waitFor(() => expect(screen.getByText("Motion sequence completed: raise, dwell, lower, home")).toBeTruthy());
    expect(commands).toEqual(["?", "a", "h"]);
    expect(commands).not.toContain("u");
    expect(commands).not.toContain("d");
  });

  it("stages every Simulator scenario for a future guarded Nano run", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Simulator/ }));
    fireEvent.click(screen.getByRole("button", { name: /Home run/ }));

    expect(screen.getByText(/1 raise \/ lower sequence expected/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run on device" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Physical cycle" }));
    expect(screen.getByRole("button", { name: "Physical cycle" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("labels the grand-slam Simulator scenario distinctly", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Simulator/ }));
    fireEvent.click(screen.getByRole("button", { name: /Grand slam/ }));
    fireEvent.click(screen.getByRole("button", { name: "Step frame" }));

    expect(screen.getByText("GRAND SLAM!!")).toBeTruthy();
    expect(screen.getByText(/1 raise \/ lower sequence expected/)).toBeTruthy();
  });

  it("exposes Historical Replay as a standard Apple Lab source", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Historical replay/ }));

    expect(screen.getByRole("heading", { name: "Historical replay" })).toBeTruthy();
    expect(screen.getByText("Recording-only replay")).toBeTruthy();
    expect(screen.getByText(/C\+\+ game-state projector and decision core/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load archive" }).hasAttribute("disabled")).toBe(true);
  });

  it("identifies the C++ game-state boundary on the direct MLB source", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Live game/ }));
    fireEvent.click(screen.getByRole("button", { name: /MLB direct/ }));

    expect(screen.getByText(/C\+\+ game-state projector before its smaller evidence envelope/)).toBeTruthy();
  });

  it("has no automated semantic accessibility violations on the default workspace", async () => {
    const { container } = render(<App />);
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
