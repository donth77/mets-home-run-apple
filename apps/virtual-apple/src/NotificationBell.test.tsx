/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "./NotificationBell";
import {
  currentPushSubscription,
  disablePushNotifications,
  enablePushNotifications,
  pushNotificationsSupported,
  registerNotificationServiceWorker,
  subscriptionStatus,
} from "./notificationClient";
import { describeEnableFailure, useNotificationSubscription } from "./useNotificationSubscription";

vi.mock("./notificationClient", () => ({
  currentPushSubscription: vi.fn(),
  disablePushNotifications: vi.fn(),
  enablePushNotifications: vi.fn(),
  pushNotificationsSupported: vi.fn(),
  registerNotificationServiceWorker: vi.fn(),
  savePushPreferences: vi.fn(),
  sendServerTestPush: vi.fn(),
  showLocalTestNotification: vi.fn(),
  subscriptionStatus: vi.fn(),
}));

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/token",
  toJSON: vi.fn(),
  unsubscribe: vi.fn(),
} as unknown as PushSubscription;

/** The bell as the app mounts it: fed by one subscription state held above it. */
function Bell() {
  const notifications = useNotificationSubscription(true);
  return <NotificationBell notifications={notifications} />;
}

function bellButton(getByRole: (role: string, options: { name: string }) => HTMLElement, name: string) {
  return getByRole("button", { name }) as HTMLButtonElement;
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: { permission: "default", requestPermission: vi.fn() },
  });
  vi.mocked(pushNotificationsSupported).mockReturnValue(true);
  vi.mocked(registerNotificationServiceWorker).mockResolvedValue({} as ServiceWorkerRegistration);
  vi.mocked(currentPushSubscription).mockResolvedValue(null);
  vi.mocked(enablePushNotifications).mockResolvedValue({ permission: "granted", subscription });
  vi.mocked(subscriptionStatus).mockResolvedValue({
    enabled: true,
    preferences: { homeRuns: true, metsWins: true },
    lastPush: null,
  });
  vi.mocked(disablePushNotifications).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(globalThis, "Notification");
});

describe("desktop notification bell", () => {
  it("starts off and turns on both alert types with one press", async () => {
    const { getByRole } = render(<Bell />);
    const bell = bellButton(getByRole, "Turn notifications on");
    expect(bell.disabled).toBe(false);
    expect(bell.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(bell);

    await waitFor(() => expect(bellButton(getByRole, "Turn notifications off").getAttribute("aria-pressed")).toBe("true"));
    expect(enablePushNotifications).toHaveBeenCalledWith({ homeRuns: true, metsWins: true });
    expect(bellButton(getByRole, "Turn notifications off").title).toBe("Notifications on: home runs and Mets wins");
  });

  it("lights the moment it is pressed, before the browser and server have answered", async () => {
    let finish: (value: { permission: "granted"; subscription: PushSubscription }) => void = () => {};
    vi.mocked(enablePushNotifications).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { getByRole } = render(<Bell />);

    fireEvent.click(bellButton(getByRole, "Turn notifications on"));

    const lit = bellButton(getByRole, "Turn notifications off");
    expect(lit.getAttribute("aria-pressed")).toBe("true");
    expect(lit.getAttribute("aria-busy")).toBe("true");
    expect(lit.title).toBe("Turning on notifications…");

    finish({ permission: "granted", subscription });
    await waitFor(() => expect(bellButton(getByRole, "Turn notifications off").getAttribute("aria-busy")).toBeNull());
  });

  it("opens already on when this browser is subscribed", async () => {
    vi.mocked(currentPushSubscription).mockResolvedValue(subscription);

    const { getByRole } = render(<Bell />);

    await waitFor(() => expect(bellButton(getByRole, "Turn notifications off").getAttribute("aria-pressed")).toBe("true"));
    expect(subscriptionStatus).toHaveBeenCalledWith(subscription);
    expect(window.localStorage.getItem("virtual-apple:notifications")).toBe("on");
  });

  it("opens on straight away when it was on last time, then trusts the server", async () => {
    window.localStorage.setItem("virtual-apple:notifications", "on");
    vi.mocked(currentPushSubscription).mockResolvedValue(null);

    const { getByRole } = render(<Bell />);

    expect(bellButton(getByRole, "Turn notifications off").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(bellButton(getByRole, "Turn notifications on").getAttribute("aria-pressed")).toBe("false"));
    expect(window.localStorage.getItem("virtual-apple:notifications")).toBe("off");
  });

  it("turns off at once with a second press and forgets the browser subscription behind it", async () => {
    vi.mocked(currentPushSubscription).mockResolvedValue(subscription);
    vi.mocked(disablePushNotifications).mockReturnValue(new Promise(() => {}));
    const { getByRole } = render(<Bell />);
    const bell = await waitFor(() => bellButton(getByRole, "Turn notifications off"));

    fireEvent.click(bell);

    expect(bellButton(getByRole, "Turn notifications on").getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(disablePushNotifications).toHaveBeenCalledWith(subscription));
    expect(window.localStorage.getItem("virtual-apple:notifications")).toBe("off");
  });

  it("sits greyed out with an explanation when the browser has blocked the site", async () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: { permission: "denied", requestPermission: vi.fn() },
    });

    const { getByRole } = render(<Bell />);

    await waitFor(() => expect(bellButton(getByRole, "Turn notifications on").disabled).toBe(true));
    expect(bellButton(getByRole, "Turn notifications on").title).toContain("blocked");
    expect(enablePushNotifications).not.toHaveBeenCalled();
  });

  it("drops back and says what went wrong under the toolbar when enabling fails", async () => {
    vi.mocked(enablePushNotifications).mockRejectedValue(new Error("Notifications are temporarily unavailable."));
    const { getByRole, findByRole } = render(<Bell />);

    fireEvent.click(bellButton(getByRole, "Turn notifications on"));

    const note = await findByRole("status");
    expect(note.textContent).toBe("Notifications are temporarily unavailable.");
    expect(bellButton(getByRole, "Turn notifications on").getAttribute("aria-pressed")).toBe("false");
  });

  it("explains a push service failure in the browser's own terms", () => {
    const failure = new Error("Registration failed - push service error");
    expect(describeEnableFailure(failure, { brave: {} } as unknown as Navigator)).toContain(
      "Use Google services for push messaging",
    );
    expect(describeEnableFailure(failure, {} as Navigator)).toContain("could not reach its push service");
    expect(describeEnableFailure(new Error("Notifications are temporarily unavailable."), {} as Navigator)).toBe(
      "Notifications are temporarily unavailable.",
    );
    expect(describeEnableFailure(undefined, {} as Navigator)).toBe("Notifications could not be enabled.");
  });

  it("renders nothing where the browser has no push support", () => {
    vi.mocked(pushNotificationsSupported).mockReturnValue(false);

    const { queryByRole } = render(<Bell />);

    expect(queryByRole("button")).toBeNull();
  });
});
