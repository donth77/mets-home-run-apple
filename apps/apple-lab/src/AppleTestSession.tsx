import type { AppleDeviceState } from "./useAppleDevice";

// Where a physical test stands, in one line. The test buttons do the asking;
// this only tells the owner what the Apple is waiting for.
export function AppleTestSession({ apple }: { apple: AppleDeviceState }) {
  if (apple.transport === "USB")
    return <p className="apple-test-session">USB telemetry is read-only. Connect over Wi-Fi to run a test.</p>;
  if (!apple.status) return <p className="apple-test-session">Connect to your Apple over Wi-Fi to run a test.</p>;
  if (!apple.status.maintenance.supported)
    return <p className="apple-test-session">Update the Apple's firmware to run tests from Apple Lab.</p>;
  const seconds = Math.max(0, Math.ceil(apple.status.maintenance.remainingMs / 1000));
  const running = apple.status.mode === "REPLAY" || apple.status.fixture.state === "RUNNING";
  return (
    <div className="apple-test-session">
      <strong role="status">
        {apple.queued
          ? apple.connection === "CONNECTED"
            ? `Waiting for the owner button · ${seconds} s`
            : "Waiting for the owner button · reconnecting to the Apple"
          : apple.connection !== "CONNECTED"
            ? "Test controls paused · waiting for fresh status"
            : running
              ? "Test in progress on the Apple"
              : apple.canTest
                ? "Approved · starting"
                : "Ready"}
      </strong>
      <p>
        {apple.queued
          ? "Walk to the Apple and tap its owner button once — don't hold it. The test starts by itself; the Apple's screen counts the window down."
          : running
            ? "Let it finish and come home before starting another."
            : "Click a test. The Apple will ask for one tap of its owner button, then run it. Keep the lift's travel path clear."}
      </p>
      {apple.error && <p role="alert">{apple.error}</p>}
    </div>
  );
}
