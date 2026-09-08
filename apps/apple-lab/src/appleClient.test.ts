import { describe, expect, it, vi } from "vitest";
import { AppleRequestError, describeAppleError, fetchAppleStatus, requestAppleCelebration } from "./appleClient";
import statusFixture from "./fixtures/apple-status.json";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("fetchAppleStatus", () => {
  it("asks the relay for the chosen Apple and parses the frame", async () => {
    const fetchImpl = fakeFetch(200, statusFixture);
    const status = await fetchAppleStatus({ host: "192.168.1.139", code: "1234", fetchImpl });
    expect(status.mode).toBe("UPCOMING");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/device/api/status");
    const headers = new Headers(init.headers);
    expect(headers.get("X-Apple-Host")).toBe("192.168.1.139");
    expect(headers.get("X-Apple-Code")).toBe("1234");
    expect(init.cache).toBe("no-store");
  });

  it("surfaces a relay failure as an Apple error", async () => {
    const fetchImpl = fakeFetch(502, { ok: false, error: "RELAY", detail: "connect ECONNREFUSED" });
    await expect(fetchAppleStatus({ host: "nowhere.local", fetchImpl })).rejects.toMatchObject({
      name: "AppleRequestError",
      code: "RELAY",
      status: 502,
    });
  });
});

describe("requestAppleCelebration", () => {
  it("posts the replay kind with the code", async () => {
    const fetchImpl = fakeFetch(200, { ok: true });
    await requestAppleCelebration({ host: "home-run-apple.local", code: "9999", fetchImpl }, "win");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/device/api/replay?kind=win");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("X-Apple-Code")).toBe("9999");
  });

  it("maps the Apple's refusals to their codes", async () => {
    for (const [status, error] of [
      [401, "CODE"],
      [429, "LOCKED"],
      [409, "CELEBRATING"],
      [404, "NO_REPLAY"],
    ] as const) {
      const fetchImpl = fakeFetch(status, { ok: false, error });
      await expect(requestAppleCelebration({ host: "h", code: "c", fetchImpl }, "hr")).rejects.toMatchObject({
        code: error,
        status,
      });
    }
  });
});

describe("describeAppleError", () => {
  it("explains known refusals in plain words", () => {
    expect(describeAppleError(new AppleRequestError("CODE", 401))).toMatch(/setup code/i);
    expect(describeAppleError(new AppleRequestError("LOCKED", 429))).toMatch(/minute/);
    expect(describeAppleError(new AppleRequestError("CELEBRATING", 409))).toMatch(/already celebrating/);
    expect(describeAppleError(new AppleRequestError("RELAY", 502))).toMatch(/not reachable/);
    expect(describeAppleError(new AppleRequestError("WEIRD", 418))).toBe("The Apple answered WEIRD.");
    expect(describeAppleError(new Error("boom"))).toBe("boom");
  });
});
