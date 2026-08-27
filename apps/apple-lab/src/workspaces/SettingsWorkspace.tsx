import { fakeManagedDevice } from "../fakeDevice";
import { WorkspaceHeading } from "../managerComponents";

export function SettingsWorkspace() {
  const device = fakeManagedDevice;
  return (
    <section className="workspace" aria-labelledby="settings-title">
      <WorkspaceHeading
        eyebrow="Local configuration"
        title="Settings"
        titleId="settings-title"
        description="The fake adapter previews the settings model. Editing remains unavailable until an authenticated physical-device transport is connected."
      />
      <div className="settings-notice">
        <strong>Preview only</strong>
        <span>These controls are intentionally locked and cannot change firmware or device state.</span>
      </div>
      <div className="settings-grid">
        <section className="manager-panel settings-section">
          <header className="panel-title">
            <div>
              <span>Identity</span>
              <h2>Device</h2>
            </div>
          </header>
          <label>
            Display name
            <input value={device.name} disabled readOnly />
          </label>
          <label>
            Local hostname
            <input value={device.host} disabled readOnly />
          </label>
          <label>
            Device ID
            <input value={device.id} disabled readOnly />
          </label>
        </section>
        <section className="manager-panel settings-section">
          <header className="panel-title">
            <div>
              <span>Game service</span>
              <h2>Autonomous live mode</h2>
            </div>
          </header>
          <label>
            Operating mode
            <select value="AUTONOMOUS_LIVE" disabled>
              <option>AUTONOMOUS_LIVE</option>
            </select>
          </label>
          <label>
            Raised duration
            <input value="30 seconds" disabled readOnly />
          </label>
          <label>
            Data strategy
            <input value="Incremental live-feed patches" disabled readOnly />
          </label>
          <p>Live mode is the boot default and does not depend on Apple Lab remaining connected.</p>
        </section>
        <section className="manager-panel settings-section">
          <header className="panel-title">
            <div>
              <span>Connectivity</span>
              <h2>Wi-Fi</h2>
            </div>
          </header>
          <label>
            Network
            <input value={device.wifiNetwork} disabled readOnly />
          </label>
          <label>
            Signal
            <input value={`${device.wifiSignalDbm} dBm`} disabled readOnly />
          </label>
          <button type="button" disabled>
            Re-provision Wi-Fi
          </button>
        </section>
        <section className="manager-panel settings-section">
          <header className="panel-title">
            <div>
              <span>Maintenance</span>
              <h2>Firmware update</h2>
            </div>
          </header>
          <label>
            Installed version
            <input value={`v${device.firmwareVersion}`} disabled readOnly />
          </label>
          <label>
            Update channel
            <select value="Stable" disabled>
              <option>Stable</option>
            </select>
          </label>
          <button type="button" disabled>
            Choose signed firmware
          </button>
          <p>Wireless updates will require an authenticated local connection and signature verification.</p>
        </section>
      </div>
    </section>
  );
}
