import { type FormEvent, useEffect, useState } from "react";
import { describeRssi, describeSequence, sequenceTone } from "./appleDevice";
import type { AppleDeviceState } from "./useAppleDevice";

// The sidebar's device slot: the physical Apple over Wi-Fi when it is
// connected, and the form to connect it when it is not.

export function AppleConnectionPanel({ apple, benchConnected }: { apple: AppleDeviceState; benchConnected: boolean }) {
  const [host, setHost] = useState(apple.host);
  const [code, setCode] = useState(apple.code);
  const [open, setOpen] = useState(false);
  useEffect(() => setHost(apple.host), [apple.host]);
  useEffect(() => setCode(apple.code), [apple.code]);

  const connecting = apple.connection === "CONNECTING";
  const linked = apple.connection === "CONNECTED" || apple.connection === "STALE";
  const status = apple.status;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setOpen(false);
    void apple.connect(host, code);
  };

  if (linked && status) {
    const tone = sequenceTone(status.sequence, status.fault);
    return (
      <section className="sidebar-device sidebar-device--apple" aria-label="Connected Apple">
        <div>
          <span className={apple.connection === "STALE" ? "connection-dot connection-dot--offline" : "connection-dot"} />
          <strong>Home Run Apple</strong>
        </div>
        <small>{apple.host}</small>
        <small>
          Wi-Fi {status.wifi.rssi} dBm · {describeRssi(status.wifi.rssi)} · v{status.firmwareVersion} on{" "}
          {status.firmwareSlot}
        </small>
        <span data-tone={tone}>
          {apple.connection === "STALE" ? "WI-FI · NOT ANSWERING" : `WI-FI · ${describeSequence(status.sequence, status.fault).toUpperCase()}`}
        </span>
        <button type="button" className="secondary-button apple-connect__button" onClick={apple.disconnect}>
          Disconnect
        </button>
      </section>
    );
  }

  return (
    <section className="sidebar-device" aria-label="Selected device">
      <div>
        <span className={benchConnected ? "connection-dot" : "connection-dot connection-dot--offline"} />
        <strong>{benchConnected ? "Nano ESP32" : connecting ? "Finding the Apple…" : "No physical device"}</strong>
      </div>
      <small>{benchConnected ? "USB serial · local bench" : "Connect your Apple over Wi-Fi"}</small>
      <span>{benchConnected ? "USB BENCH · CONNECTED" : "APPLE · DISCONNECTED"}</span>
      {open || connecting ? (
        <form className="apple-connect" onSubmit={submit} aria-label="Connect to the Apple over Wi-Fi">
          <label>
            Address
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="home-run-apple.local"
              autoComplete="off"
              spellCheck={false}
              disabled={connecting}
            />
          </label>
          <label>
            Setup code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="on the Apple's info screen"
              disabled={connecting}
            />
          </label>
          <div className="apple-connect__actions">
            <button type="submit" className="primary-button" disabled={connecting}>
              {connecting ? "Connecting…" : "Connect"}
            </button>
            <button type="button" className="secondary-button" onClick={() => setOpen(false)} disabled={connecting}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="primary-button apple-connect__button" onClick={() => setOpen(true)}>
          Connect to Apple
        </button>
      )}
      {apple.error && !linked ? (
        <p className="apple-connect__error" role="alert">
          {apple.error}
        </p>
      ) : null}
    </section>
  );
}
