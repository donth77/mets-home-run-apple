import { describe, expect, it } from "vitest";
import { parseUsbBenchLine } from "./usbBenchProtocol";

describe("USB bench protocol", () => {
  it("parses a versioned firmware hello", () => {
    expect(
      parseUsbBenchLine(
        'APPLE_BENCH:{"type":"hello","protocolVersion":1,"profile":"motor_logic_test","firmwareVersion":"0.1.0","safetyMode":"USB_LOGIC_ONLY"}',
      ),
    ).toEqual({
      type: "hello",
      protocolVersion: 1,
      profile: "motor_logic_test",
      firmwareVersion: "0.1.0",
      safetyMode: "USB_LOGIC_ONLY",
    });
  });

  it("parses output state and bounded test receipts", () => {
    expect(parseUsbBenchLine('APPLE_BENCH:{"type":"state","state":"RAISE","ena":1,"in1":1,"in2":0}')).toEqual({
      type: "state",
      state: "RAISE",
      ena: 1,
      in1: 1,
      in2: 0,
    });
    expect(parseUsbBenchLine('APPLE_BENCH:{"type":"test","name":"motor_logic","status":"PASSED"}')).toEqual({
      type: "test",
      name: "motor_logic",
      status: "PASSED",
    });
  });

  it("ignores malformed, unprefixed, and unsafe messages", () => {
    expect(parseUsbBenchLine("LOGIC_STATE=STOP ENA=0 IN1=0 IN2=0")).toBeUndefined();
    expect(parseUsbBenchLine("APPLE_BENCH:not-json")).toBeUndefined();
    expect(parseUsbBenchLine('APPLE_BENCH:{"type":"state","state":"RAISE","ena":1,"in1":1,"in2":1}')).toEqual({
      type: "state",
      state: "RAISE",
      ena: 1,
      in1: 1,
      in2: 1,
    });
    expect(
      parseUsbBenchLine(
        'APPLE_BENCH:{"type":"hello","protocolVersion":1,"profile":"actuator","firmwareVersion":"0.1.0","safetyMode":"POWERED"}',
      ),
    ).toBeUndefined();
  });
});

describe("USB jog protocol", () => {
  it("parses the jog hello, status, and plain receipts", () => {
    expect(
      parseUsbBenchLine(
        'APPLE_JOG:{"type":"hello","profile":"actuator_jog_test","firmwareVersion":"0.1.0","maxJogMs":200,"armWindowMs":60000}',
      ),
    ).toEqual({
      type: "jog-hello",
      profile: "actuator_jog_test",
      firmwareVersion: "0.1.0",
      maxJogMs: 200,
      armWindowMs: 60000,
    });
    expect(
      parseUsbBenchLine(
        'APPLE_JOG:{"type":"status","firmwareVersion":"0.1.0","armed":true,"motion":"EXTEND","maxJogMs":10000}',
      ),
    ).toEqual({ type: "jog-status", firmwareVersion: "0.1.0", armed: true, motion: "EXTEND", maxJogMs: 10000 });
    expect(parseUsbBenchLine("ACTUATOR_JOG=ARMED AUTO_DISARM_MS=60000")).toEqual({
      type: "jog-receipt",
      receipt: "ARMED",
    });
    expect(parseUsbBenchLine("ACTUATOR_JOG=AUTO_STOP")).toEqual({ type: "jog-receipt", receipt: "AUTO_STOP" });
    expect(parseUsbBenchLine("ACTUATOR_JOG=REJECTED REASON=DISARMED")).toEqual({
      type: "jog-receipt",
      receipt: "REJECTED",
      reason: "DISARMED",
    });
  });

  it("ignores the ready banner and unknown profiles", () => {
    expect(
      parseUsbBenchLine("ACTUATOR_JOG=READY COMMANDS=a:arm u:extend d:retract x:stop_and_disarm ?:status"),
    ).toBeUndefined();
    expect(
      parseUsbBenchLine(
        'APPLE_JOG:{"type":"hello","profile":"raw_motor","firmwareVersion":"0.1.0","maxJogMs":200,"armWindowMs":60000}',
      ),
    ).toBeUndefined();
    expect(
      parseUsbBenchLine(
        'APPLE_JOG:{"type":"status","firmwareVersion":"0.1.0","armed":"yes","motion":"EXTEND","maxJogMs":200}',
      ),
    ).toBeUndefined();
  });
});

describe("USB motion commissioning protocol", () => {
  const hello =
    'APPLE_MOTION:{"type":"hello","profile":"motion_commissioning","firmwareVersion":"0.1.0","strokeMm":50,"extendFullMs":5500,"retractFullMs":5300,"overrunMs":1500,"deadlineMs":10000,"leadInMs":2000,"dwellMs":30000,"armWindowMs":60000}';

  it("parses the hello, state, trace, and run receipts", () => {
    expect(parseUsbBenchLine(hello)).toEqual({
      type: "motion-hello",
      profile: "motion_commissioning",
      firmwareVersion: "0.1.0",
      strokeMm: 50,
      extendFullMs: 5500,
      retractFullMs: 5300,
      overrunMs: 1500,
      deadlineMs: 10000,
      leadInMs: 2000,
      dwellMs: 30000,
      armWindowMs: 60000,
    });
    expect(
      parseUsbBenchLine(
        'APPLE_MOTION:{"type":"state","armed":false,"sequence":"EXTENDING","drive":"EXTEND","positionMm":12,"positionKnown":false,"fault":false,"ena":1,"in1":1,"in2":0}',
      ),
    ).toEqual({
      type: "motion-state",
      armed: false,
      sequence: "EXTENDING",
      drive: "EXTEND",
      positionMm: 12,
      positionKnown: false,
      fault: false,
      ena: 1,
      in1: 1,
      in2: 0,
    });
    expect(parseUsbBenchLine('APPLE_MOTION:{"type":"trace","code":"POSITION_RAISED","detail":"bench:play-1"}')).toEqual(
      {
        type: "motion-trace",
        code: "POSITION_RAISED",
        detail: "bench:play-1",
      },
    );
    expect(parseUsbBenchLine('APPLE_MOTION:{"type":"run","status":"COMPLETED"}')).toEqual({
      type: "motion-run",
      status: "COMPLETED",
    });
  });

  it("carries the optional current-sense fields when a build reports them", () => {
    expect(
      parseUsbBenchLine(
        'APPLE_MOTION:{"type":"state","armed":false,"sequence":"EXTENDING","drive":"EXTEND","positionMm":12,"positionKnown":false,"fault":false,"ena":1,"in1":1,"in2":0,"currentMa":330}',
      ),
    ).toMatchObject({ type: "motion-state", currentMa: 330 });
    expect(parseUsbBenchLine(hello.replace("}", ',"currentSenseBuild":true,"currentSensor":true}'))).toMatchObject({
      type: "motion-hello",
      currentSensor: true,
    });
  });

  it("rejects unknown sequence states and run statuses", () => {
    expect(
      parseUsbBenchLine(
        'APPLE_MOTION:{"type":"state","armed":false,"sequence":"FLYING","drive":"EXTEND","positionMm":12,"positionKnown":false,"fault":false,"ena":1,"in1":1,"in2":0}',
      ),
    ).toBeUndefined();
    expect(parseUsbBenchLine('APPLE_MOTION:{"type":"run","status":"MAYBE"}')).toBeUndefined();
  });
});
