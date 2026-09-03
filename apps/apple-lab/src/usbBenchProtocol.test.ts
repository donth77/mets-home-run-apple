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

describe("USB audio protocol", () => {
  it("parses the hello, state, card listing, checksum, playback, gain, and test receipts", () => {
    expect(
      parseUsbBenchLine(
        'APPLE_AUDIO:{"type":"hello","profile":"audio_test","firmwareVersion":"0.1.0","sdChipSelect":"A0","i2s":{"bclk":"A1","lrc":"A2","din":"A3"},"gainPercent":10,"gainCapPercent":35,"fixture":"/tone.wav"}',
      ),
    ).toEqual({
      type: "audio-hello",
      profile: "audio_test",
      firmwareVersion: "0.1.0",
      sdChipSelect: "A0",
      i2s: { bclk: "A1", lrc: "A2", din: "A3" },
      gainPercent: 10,
      gainCapPercent: 35,
      fixture: "/tone.wav",
    });
    expect(
      parseUsbBenchLine(
        'APPLE_AUDIO:{"type":"state","sdMounted":true,"cardMb":7580,"playing":"TONE 440 Hz","status":"STARTED","gainPercent":20}',
      ),
    ).toEqual({
      type: "audio-state",
      sdMounted: true,
      cardMb: 7580,
      playing: "TONE 440 Hz",
      status: "STARTED",
      gainPercent: 20,
    });
    expect(
      parseUsbBenchLine(
        'APPLE_AUDIO:{"type":"sd","status":"MOUNTED","cardMb":7580,"files":[{"name":"tone.wav","bytes":88244},{"name":"walkup.wav","bytes":1234567}]}',
      ),
    ).toEqual({
      type: "audio-sd",
      status: "MOUNTED",
      cardMb: 7580,
      files: [
        { name: "tone.wav", bytes: 88244 },
        { name: "walkup.wav", bytes: 1234567 },
      ],
    });
    expect(
      parseUsbBenchLine(
        'APPLE_AUDIO:{"type":"checksum","status":"OK","file":"/tone.wav","bytes":88244,"crc32":"1a2b3c4d"}',
      ),
    ).toEqual({ type: "audio-checksum", status: "OK", file: "/tone.wav", bytes: 88244, crc32: "1a2b3c4d" });
    expect(parseUsbBenchLine('APPLE_AUDIO:{"type":"checksum","status":"NO_CARD"}')).toEqual({
      type: "audio-checksum",
      status: "NO_CARD",
    });
    expect(parseUsbBenchLine('APPLE_AUDIO:{"type":"play","status":"STARTED","source":"SD /tone.wav"}')).toEqual({
      type: "audio-play",
      status: "STARTED",
      source: "SD /tone.wav",
    });
    expect(parseUsbBenchLine('APPLE_AUDIO:{"type":"gain","percent":35}')).toEqual({ type: "audio-gain", percent: 35 });
    expect(
      parseUsbBenchLine(
        'APPLE_AUDIO:{"type":"test","name":"display_sd_alternation","status":"PASSED","passes":100,"fails":0}',
      ),
    ).toEqual({ type: "audio-test", name: "display_sd_alternation", status: "PASSED", passes: 100, fails: 0 });
  });

  it("rejects unknown statuses and malformed card listings", () => {
    expect(parseUsbBenchLine('APPLE_AUDIO:{"type":"play","status":"LOUD","source":"SD /tone.wav"}')).toBeUndefined();
    expect(
      parseUsbBenchLine('APPLE_AUDIO:{"type":"test","name":"display_sd_alternation","status":"MAYBE"}'),
    ).toBeUndefined();
    expect(
      parseUsbBenchLine('APPLE_AUDIO:{"type":"sd","status":"MOUNTED","cardMb":7580,"files":[{"name":"tone.wav"}]}'),
    ).toBeUndefined();
    expect(
      parseUsbBenchLine('APPLE_AUDIO:{"type":"checksum","status":"OK","file":"/tone.wav","bytes":88244}'),
    ).toBeUndefined();
    expect(parseUsbBenchLine("AUDIO_TEST=READY COMMANDS=m:mount_sd k:checksum t:tone")).toBeUndefined();
  });
});
