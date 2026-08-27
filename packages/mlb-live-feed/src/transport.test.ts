import { afterEach, describe, expect, it, vi } from "vitest";
import { MAXIMUM_RESPONSE_BYTES, MLB_REQUEST_TIMEOUT_MS } from "./constants";
import { fetchJson } from "./transport";

afterEach(() => {
  vi.useRealTimers();
});

describe("bounded MLB transport", () => {
  it("aborts stalled requests at the internal deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true,
          });
        }),
    );

    const request = fetchJson(fetcher, "https://statsapi.mlb.com/example");
    const assertion = expect(request).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(MLB_REQUEST_TIMEOUT_MS);
    await assertion;
  });

  it("enforces the byte limit while reading a streamed response", async () => {
    const oversized = "x".repeat(MAXIMUM_RESPONSE_BYTES + 1);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(oversized));

    await expect(fetchJson(fetcher, "https://statsapi.mlb.com/example")).rejects.toMatchObject({
      code: "OVERSIZED_RESPONSE",
    });
  });

  it("preserves an explicit caller abort", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true,
          });
        }),
    );
    const request = fetchJson(fetcher, "https://statsapi.mlb.com/example", controller.signal);
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
