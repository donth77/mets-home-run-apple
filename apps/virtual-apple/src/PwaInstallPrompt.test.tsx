/** @vitest-environment happy-dom */

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPlatform, PwaInstallPrompt } from "./PwaInstallPrompt";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function pretendPlatform(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });
  Object.defineProperty(window.navigator, "maxTouchPoints", { configurable: true, value: maxTouchPoints });
}

function installPromptEvent(outcome: "accepted" | "dismissed") {
  return Object.assign(new Event("beforeinstallprompt"), {
    prompt: vi.fn().mockResolvedValue({ outcome }),
  });
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(window.navigator, "standalone", { configurable: true, value: false });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window.navigator, "standalone");
  Reflect.deleteProperty(window.navigator, "userAgent");
  Reflect.deleteProperty(window.navigator, "maxTouchPoints");
});

describe("installPlatform", () => {
  it("tells iPhones, iPads, Android phones and everything else apart", () => {
    expect(installPlatform({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe("ios");
    expect(installPlatform({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe("ios");
    expect(installPlatform({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe("other");
    expect(installPlatform({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe("android");
    expect(installPlatform({ userAgent: DESKTOP, maxTouchPoints: 0 })).toBe("other");
  });
});

describe("PWA install prompt", () => {
  it("opens the browser's native install prompt and hides after acceptance", async () => {
    const { getByRole, queryByRole } = render(<PwaInstallPrompt />);
    const event = installPromptEvent("accepted");

    act(() => window.dispatchEvent(event));
    fireEvent.click(getByRole("button", { name: "Add to home screen" }));

    await waitFor(() => expect(event.prompt).toHaveBeenCalledOnce());
    await waitFor(() => expect(queryByRole("button", { name: "Add to home screen" })).toBeNull());
  });

  it("gives an iPhone the Share sheet steps when the browser has no install prompt", () => {
    pretendPlatform(IPHONE, 5);
    const { getByRole } = render(<PwaInstallPrompt />);

    fireEvent.click(getByRole("button", { name: "Add to home screen" }));

    expect(getByRole("status").textContent).toBe("Tap Share, then Add to Home Screen.");
  });

  it("gives an Android phone the browser menu steps, and never both", () => {
    pretendPlatform(ANDROID, 5);
    const { getByRole } = render(<PwaInstallPrompt />);

    fireEvent.click(getByRole("button", { name: "Add to home screen" }));

    expect(getByRole("status").textContent).toBe("Open the browser menu and choose Add to Home screen.");
    expect(getByRole("status").textContent).not.toContain("iPhone");
  });

  it("names the browser menu when an Android user dismisses the native prompt", async () => {
    pretendPlatform(ANDROID, 5);
    const { getByRole } = render(<PwaInstallPrompt />);
    const event = installPromptEvent("dismissed");

    act(() => window.dispatchEvent(event));
    fireEvent.click(getByRole("button", { name: "Add to home screen" }));

    await waitFor(() => expect(getByRole("status").textContent).toBe("You can add Virtual Apple later from the browser menu."));
  });

  it("does not render when the app is already running standalone", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      matches: query === "(display-mode: standalone)",
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    }));

    const { queryByRole } = render(<PwaInstallPrompt />);

    expect(queryByRole("button", { name: "Add to home screen" })).toBeNull();
  });
});
