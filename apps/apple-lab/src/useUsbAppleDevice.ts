import { useMemo } from "react";
import { appleIsIdle, toManagedDevice } from "./appleDevice";
import type { AppleDeviceState } from "./useAppleDevice";
import type { UsbBenchDevice } from "./useUsbBenchDevice";
const noAction = async () => {};

// Production USB is a read-only telemetry source. Commissioning profiles retain
// their separate guarded controls. Never send their single-letter keys to live firmware.
export function useUsbAppleDevice(usb: UsbBenchDevice): AppleDeviceState {
  return useMemo(() => {
    const connected = usb.connection === "CONNECTED" && usb.production;
    const status = connected ? usb.liveStatus : null;
    const connection = !connected ? "DISCONNECTED" : usb.liveFresh ? "CONNECTED" : "STALE";
    return {
      connection,
      transport: "USB",
      host: "USB serial",
      code: "",
      status,
      device: status ? toManagedDevice(status, "USB serial", "USB") : null,
      error: usb.error ?? null,
      lastSeenAt: usb.liveLastSeenAt,
      events: [],
      pending: null,
      idle: connection === "CONNECTED" && status !== null && appleIsIdle(status),
      canTest: false,
      queued: null,
      cancelQueued: noAction,
      maintenancePending: false,
      canStopTest: false,
      disarmTest: noAction,
      connect: noAction,
      disconnect: () => {
        void usb.disconnect();
      },
      requestTestSession: noAction,
      testCelebration: noAction,
      runFixture: noAction,
      stopFixture: noAction,
    };
  }, [usb]);
}
