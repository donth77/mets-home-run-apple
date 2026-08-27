/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("Apple Lab manager", () => {
  it("uses team nicknames in the compact engineering scoreboard", () => {
    const { container } = render(<App />);
    const teamNames = [...container.querySelectorAll(".apple-scoreboard__name")].map((node) => node.textContent);

    expect(teamNames).toContain("Braves");
    expect(teamNames).not.toContain("Atlanta");
  });

  it("opens the read-only live timeline with significant events", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Your Apple is ready" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Live game/ }));

    expect(screen.getByRole("heading", { name: "Live game" })).toBeTruthy();
    expect(screen.getByText("Juan Soto · Home run")).toBeTruthy();
    expect(screen.getByText("Mets win")).toBeTruthy();
    expect(screen.queryByText(/Pitch 4/)).toBeNull();
  });

  it("paginates history and exports every matching row rather than only the current page", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Live game/ }));

    expect(screen.getByText("1–5 of 6")).toBeTruthy();
    const exportButton = screen.getByRole("button", { name: "Export CSV" });
    expect(exportButton.getAttribute("title")).toContain("all 6 matching rows");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect(screen.getByText("Live feed connected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "System" }));
    expect(screen.getByText("1–1 of 1")).toBeTruthy();
    expect(screen.getByText("Page 1 of 1")).toBeTruthy();
  });

  it("labels timeline timestamps as browser-local time", () => {
    render(<App />);
    expect(screen.getByText(/browser time$/)).toBeTruthy();
  });

  it("keeps service actions locked until a recording session is armed", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Hardware tests/ }));

    const lockedButtons = screen.getAllByRole("button", { name: "Locked" });
    expect(lockedButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Arm recording controls" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Record test" })[1]);

    expect(screen.getByText("Raise / lower cycle recorded")).toBeTruthy();
    expect(screen.getByText(/No physical output was available/)).toBeTruthy();
  });

  it("stages every Simulator scenario for a future guarded Nano run", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Simulator/ }));
    fireEvent.click(screen.getByRole("button", { name: /Home run/ }));

    expect(screen.getByText(/1 raise \/ lower sequence expected/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run on device" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Physical cycle" }));
    expect(screen.getByRole("button", { name: "Physical cycle" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("labels the grand-slam Simulator scenario distinctly", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Simulator/ }));
    fireEvent.click(screen.getByRole("button", { name: /Grand slam/ }));
    fireEvent.click(screen.getByRole("button", { name: "Step frame" }));

    expect(screen.getByText("GRAND SLAM!!")).toBeTruthy();
    expect(screen.getByText(/1 raise \/ lower sequence expected/)).toBeTruthy();
  });

  it("exposes Historical Replay as a standard Apple Lab source", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Historical replay/ }));

    expect(screen.getByRole("heading", { name: "Historical replay" })).toBeTruthy();
    expect(screen.getByText("Recording-only replay")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load archive" }).hasAttribute("disabled")).toBe(true);
  });

  it("has no automated semantic accessibility violations on the default workspace", async () => {
    const { container } = render(<App />);
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
