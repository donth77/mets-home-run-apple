import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseUsbBenchLine,
  type UsbBenchHelloMessage,
  type UsbBenchStateMessage,
  type UsbBenchTestMessage,
  type UsbFirmwareProfile,
  type UsbJogHelloMessage,
  type UsbJogReceiptMessage,
  type UsbJogStatusMessage,
  type UsbMotionHelloMessage,
  type UsbMotionRunMessage,
  type UsbMotionStateMessage,
} from "./usbBenchProtocol";

const SERIAL_BAUD_RATE = 115_200;
const MAX_LOG_LINES = 250;

interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface SerialApiLike {
  requestPort(): Promise<SerialPortLike>;
}

type NavigatorWithSerial = Navigator & { serial?: SerialApiLike };

export type UsbBenchConnectionState = "UNSUPPORTED" | "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";

/** Single-character firmware commands. Every one is bounded by the firmware itself. */
type UsbCommand = "?" | "t" | "x" | "a" | "u" | "d" | "h";

export interface UsbBenchLogLine {
  id: number;
  receivedAt: string;
  text: string;
}

function serialApi(): SerialApiLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as NavigatorWithSerial).serial;
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotFoundError") return "No USB device was selected.";
  return error instanceof Error ? error.message : "The USB serial connection failed.";
}

export function useUsbBenchDevice() {
  const supported = serialApi() !== undefined;
  const [connection, setConnection] = useState<UsbBenchConnectionState>(supported ? "DISCONNECTED" : "UNSUPPORTED");
  const [hello, setHello] = useState<UsbBenchHelloMessage>();
  const [driverState, setDriverState] = useState<UsbBenchStateMessage>();
  const [testReceipt, setTestReceipt] = useState<(UsbBenchTestMessage & { logId: number }) | undefined>();
  const [jogHello, setJogHello] = useState<UsbJogHelloMessage>();
  const [jogStatus, setJogStatus] = useState<UsbJogStatusMessage>();
  const [jogReceipt, setJogReceipt] = useState<(UsbJogReceiptMessage & { logId: number }) | undefined>();
  const [motionHello, setMotionHello] = useState<UsbMotionHelloMessage>();
  const [motionState, setMotionState] = useState<UsbMotionStateMessage>();
  const [motionRun, setMotionRun] = useState<(UsbMotionRunMessage & { logId: number }) | undefined>();
  const [log, setLog] = useState<UsbBenchLogLine[]>([]);
  const [error, setError] = useState<string>();
  const portRef = useRef<SerialPortLike | undefined>(undefined);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | undefined>(undefined);
  const readTaskRef = useRef<Promise<void> | undefined>(undefined);
  const disconnectingRef = useRef(false);
  const nextLogIdRef = useRef(1);

  const clearDeviceState = useCallback(() => {
    setHello(undefined);
    setDriverState(undefined);
    setTestReceipt(undefined);
    setJogHello(undefined);
    setJogStatus(undefined);
    setJogReceipt(undefined);
    setMotionHello(undefined);
    setMotionState(undefined);
    setMotionRun(undefined);
  }, []);

  const acceptLine = useCallback((text: string) => {
    const line = text.trim();
    if (!line) return;
    const entry: UsbBenchLogLine = {
      id: nextLogIdRef.current++,
      receivedAt: new Date().toISOString(),
      text: line,
    };
    setLog((current) => [...current.slice(-(MAX_LOG_LINES - 1)), entry]);

    const message = parseUsbBenchLine(line);
    if (!message) return;
    switch (message.type) {
      case "hello":
        setHello(message);
        break;
      case "state":
        setDriverState(message);
        break;
      case "test":
        setTestReceipt({ ...message, logId: entry.id });
        break;
      case "jog-hello":
        setJogHello(message);
        break;
      case "jog-status":
        setJogStatus(message);
        break;
      case "jog-receipt":
        setJogReceipt({ ...message, logId: entry.id });
        break;
      case "motion-hello":
        setMotionHello(message);
        break;
      case "motion-state":
        setMotionState(message);
        break;
      case "motion-run":
        setMotionRun({ ...message, logId: entry.id });
        break;
      case "motion-trace":
        break;
    }
  }, []);

  const readPort = useCallback(
    async (port: SerialPortLike) => {
      if (!port.readable) throw new Error("The selected device does not expose a readable serial stream.");
      const reader = port.readable.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let pending = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) acceptLine(line);
        }
        pending += decoder.decode();
        if (pending.trim()) acceptLine(pending);
      } catch (readError) {
        if (!disconnectingRef.current) {
          setError(errorMessage(readError));
          setConnection("ERROR");
        }
      } finally {
        reader.releaseLock();
        if (readerRef.current === reader) readerRef.current = undefined;
        if (!disconnectingRef.current) {
          if (portRef.current === port) {
            portRef.current = undefined;
            void port.close().catch(() => undefined);
          }
          clearDeviceState();
          setConnection((current) => (current === "ERROR" ? current : "DISCONNECTED"));
        }
      }
    },
    [acceptLine, clearDeviceState],
  );

  const writeCommands = useCallback(async (commands: readonly UsbCommand[]) => {
    const port = portRef.current;
    if (!port?.writable) throw new Error("The Nano is not connected to a writable USB serial stream.");
    const writer = port.writable.getWriter();
    try {
      for (const command of commands) {
        await writer.write(new TextEncoder().encode(`${command}\n`));
      }
    } finally {
      writer.releaseLock();
    }
  }, []);

  const disconnect = useCallback(async () => {
    disconnectingRef.current = true;
    try {
      await readerRef.current?.cancel();
      await readTaskRef.current;
      await portRef.current?.close();
    } catch (closeError) {
      setError(errorMessage(closeError));
    } finally {
      readerRef.current = undefined;
      readTaskRef.current = undefined;
      portRef.current = undefined;
      disconnectingRef.current = false;
      setConnection(supported ? "DISCONNECTED" : "UNSUPPORTED");
      clearDeviceState();
    }
  }, [clearDeviceState, supported]);

  const connect = useCallback(async () => {
    const api = serialApi();
    if (!api) {
      setConnection("UNSUPPORTED");
      return;
    }
    setConnection("CONNECTING");
    setError(undefined);
    clearDeviceState();
    disconnectingRef.current = false;
    try {
      const port = await api.requestPort();
      await port.open({ baudRate: SERIAL_BAUD_RATE });
      portRef.current = port;
      setConnection("CONNECTED");
      readTaskRef.current = readPort(port);
      await writeCommands(["?"]);
    } catch (connectError) {
      setError(errorMessage(connectError));
      setConnection("ERROR");
      if (portRef.current) {
        disconnectingRef.current = true;
        try {
          await readerRef.current?.cancel();
          await readTaskRef.current;
          await portRef.current.close();
        } catch {
          // Preserve the original connection error; cleanup is best effort.
        } finally {
          readerRef.current = undefined;
          readTaskRef.current = undefined;
          portRef.current = undefined;
          disconnectingRef.current = false;
        }
      }
    }
  }, [clearDeviceState, readPort, writeCommands]);

  useEffect(() => {
    return () => {
      if (portRef.current) void disconnect();
    };
  }, [disconnect]);

  const profile: UsbFirmwareProfile | undefined = hello?.profile ?? jogHello?.profile ?? motionHello?.profile;

  const clearLog = useCallback(() => setLog([]), []);
  const queryStatus = useCallback(() => writeCommands(["?"]), [writeCommands]);
  const runLogicSelfTest = useCallback(() => writeCommands(["t"]), [writeCommands]);
  const forceStop = useCallback(() => writeCommands(["x"]), [writeCommands]);
  // The firmware authorizes exactly one jog or one run per arm, so each action
  // arms and then issues its single command.
  const jogExtend = useCallback(() => writeCommands(["a", "u"]), [writeCommands]);
  const jogRetract = useCallback(() => writeCommands(["a", "d"]), [writeCommands]);
  const startHomeRun = useCallback(() => writeCommands(["a", "h"]), [writeCommands]);

  return useMemo(
    () => ({
      supported,
      connection,
      profile,
      hello,
      driverState,
      testReceipt,
      jogHello,
      jogStatus,
      jogReceipt,
      motionHello,
      motionState,
      motionRun,
      log,
      error,
      connect,
      disconnect,
      queryStatus,
      runLogicSelfTest,
      forceStop,
      jogExtend,
      jogRetract,
      startHomeRun,
      clearLog,
    }),
    [
      clearLog,
      connect,
      connection,
      disconnect,
      driverState,
      error,
      forceStop,
      hello,
      jogExtend,
      jogHello,
      jogReceipt,
      jogRetract,
      jogStatus,
      log,
      motionHello,
      motionRun,
      motionState,
      profile,
      queryStatus,
      runLogicSelfTest,
      startHomeRun,
      supported,
      testReceipt,
    ],
  );
}

export type UsbBenchDevice = ReturnType<typeof useUsbBenchDevice>;
