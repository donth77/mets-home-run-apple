// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadioCompanion } from "./RadioCompanion";

afterEach(cleanup);

describe("RadioCompanion", () => {
  it("uses the station icon as a synchronized playback toggle", async () => {
    const { container, getByRole } = render(<RadioCompanion />);
    const audio = container.querySelector("#mets-radio-stream");
    if (!(audio instanceof HTMLAudioElement)) throw new Error("Missing radio stream");

    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    Object.defineProperties(audio, {
      pause: { configurable: true, value: pause },
      play: { configurable: true, value: play },
    });

    const iconToggle = getByRole("button", { name: "Play Mets radio" });
    expect(iconToggle.getAttribute("aria-pressed")).toBe("false");
    expect(iconToggle.querySelector(".lucide-radio-off")).not.toBeNull();

    fireEvent.click(iconToggle);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    await waitFor(() => expect(getByRole("button", { name: "Pause Mets radio" })).not.toBeNull());
    expect(iconToggle.getAttribute("aria-pressed")).toBe("true");
    expect(iconToggle.querySelector(".lucide-radio")).not.toBeNull();

    fireEvent.click(iconToggle);
    expect(pause).toHaveBeenCalledOnce();
    expect(iconToggle.getAttribute("aria-pressed")).toBe("false");
    expect(iconToggle.querySelector(".lucide-radio-off")).not.toBeNull();
  });
});
