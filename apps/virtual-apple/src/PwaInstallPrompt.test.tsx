/** @vitest-environment happy-dom */

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaInstallPrompt } from "./PwaInstallPrompt";

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

  it("provides manual instructions when the browser has no install prompt", () => {
    const { getByRole } = render(<PwaInstallPrompt />);

    fireEvent.click(getByRole("button", { name: "Add to home screen" }));

    expect(getByRole("status").textContent).toContain("tap Share");
    expect(getByRole("status").textContent).toContain("browser menu");
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
