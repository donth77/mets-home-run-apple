import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint, parsePreferences, parsePushSubscription } from "./validation";

describe("push subscription validation", () => {
  it("accepts the browser push services used by iOS, Android, Firefox, and Edge", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/token",
      "https://web.push.apple.com/QP1/token",
      "https://updates.push.services.mozilla.com/wpush/v2/token",
      "https://wns2.example.notify.windows.com/w/?token=value",
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it("rejects insecure, credentialed, and unrelated endpoints", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/token")).toBe(false);
    expect(isAllowedPushEndpoint("https://user:pass@fcm.googleapis.com/token")).toBe(false);
    expect(isAllowedPushEndpoint("https://example.com/token")).toBe(false);
    expect(isAllowedPushEndpoint("not a URL")).toBe(false);
  });

  it("requires a complete subscription and explicit preferences", () => {
    expect(
      parsePushSubscription({
        endpoint: "https://fcm.googleapis.com/fcm/send/token",
        expirationTime: null,
        keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
      }),
    ).toBeDefined();
    expect(parsePushSubscription({ endpoint: "https://example.com", keys: {} })).toBeUndefined();
    expect(parsePreferences({ homeRuns: true, metsWins: false })).toEqual({ homeRuns: true, metsWins: false });
    expect(parsePreferences({ homeRuns: true })).toBeUndefined();
  });
});
