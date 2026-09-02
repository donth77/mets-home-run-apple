import { describe, expect, it } from "vitest";
import { createAppleLabMlbRuntime } from "./mlbRecordingRuntime";

describe("Apple Lab MLB runtime", () => {
  it("loads and disposes the C++ state and decision boundaries as one session", async () => {
    const runtime = await createAppleLabMlbRuntime();
    expect(runtime.client).toBeTruthy();
    expect(runtime.core).toBeTruthy();
    runtime.dispose();
    expect(() => runtime.dispose()).not.toThrow();
  });
});
