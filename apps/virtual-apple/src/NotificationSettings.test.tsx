/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationSettings } from "./NotificationSettings";
import {
  currentPushSubscription,
  disablePushNotifications,
  enablePushNotifications,
  pushNotificationsSupported,
  registerNotificationServiceWorker,
  savePushPreferences,
  showLocalTestNotification,
  subscriptionStatus,
} from "./notificationClient";

vi.mock("./notificationClient", () => ({
  currentPushSubscription: vi.fn(),
  disablePushNotifications: vi.fn(),
  enablePushNotifications: vi.fn(),
  pushNotificationsSupported: vi.fn(),
  registerNotificationServiceWorker: vi.fn(),
  savePushPreferences: vi.fn(),
  showLocalTestNotification: vi.fn(),
  subscriptionStatus: vi.fn(),
}));

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/token",
  toJSON: vi.fn(),
  unsubscribe: vi.fn(),
} as unknown as PushSubscription;

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    matches: query === "(display-mode: standalone)",
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
  }));
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
  });
  vi.mocked(savePushPreferences).mockResolvedValue(undefined);
  vi.mocked(disablePushNotifications).mockResolvedValue(undefined);
  vi.mocked(showLocalTestNotification).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(globalThis, "Notification");
});

describe("installed PWA notification settings", () => {
  it("starts off and enables both alert types after a user click", async () => {
    const { getByRole } = render(<NotificationSettings />);
    const enable = await waitFor(() => getByRole("button", { name: "Enable notifications" }));

    fireEvent.click(enable);

    await waitFor(() => expect(enablePushNotifications).toHaveBeenCalledWith({ homeRuns: true, metsWins: true }));
    expect((getByRole("checkbox", { name: "Home runs" }) as HTMLInputElement).checked).toBe(true);
    expect((getByRole("checkbox", { name: "Mets wins" }) as HTMLInputElement).checked).toBe(true);
  });

  it("loads an existing subscription and saves each preference independently", async () => {
    vi.mocked(currentPushSubscription).mockResolvedValue(subscription);
    vi.mocked(subscriptionStatus).mockResolvedValue({
      enabled: true,
      preferences: { homeRuns: true, metsWins: false },
    });
    const { getByRole } = render(<NotificationSettings />);
    const wins = await waitFor(() => getByRole("checkbox", { name: "Mets wins" }));

    expect((wins as HTMLInputElement).checked).toBe(false);
    fireEvent.click(wins);

    await waitFor(() =>
      expect(savePushPreferences).toHaveBeenCalledWith(subscription, { homeRuns: true, metsWins: true }),
    );
  });

  it("removes the browser subscription when alerts are turned off", async () => {
    vi.mocked(currentPushSubscription).mockResolvedValue(subscription);
    const { getByRole } = render(<NotificationSettings />);
    const off = await waitFor(() => getByRole("button", { name: "Turn off" }));

    fireEvent.click(off);

    await waitFor(() => expect(disablePushNotifications).toHaveBeenCalledWith(subscription));
    expect(getByRole("button", { name: "Enable notifications" })).toBeDefined();
  });

  it("does not render outside the installed PWA", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      matches: query !== "(display-mode: standalone)",
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    }));

    const { queryByText } = render(<NotificationSettings />);

    expect(queryByText("Mets alerts")).toBeNull();
  });
});
