import { MAXIMUM_RESPONSE_BYTES, MLB_REQUEST_TIMEOUT_MS } from "./constants";
import { MlbFeedError } from "./errors";

function oversizedResponse(): MlbFeedError {
  return new MlbFeedError("MLB feed response exceeded the safety limit.", "OVERSIZED_RESPONSE");
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAXIMUM_RESPONSE_BYTES) {
    throw oversizedResponse();
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAXIMUM_RESPONSE_BYTES) throw oversizedResponse();
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw oversizedResponse();
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}

export async function fetchJson(fetcher: typeof fetch, url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MLB_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new MlbFeedError(`MLB feed returned HTTP ${response.status}.`, `HTTP_${response.status}`);
    }
    const text = await readBoundedText(response);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new MlbFeedError("MLB feed returned malformed JSON.", "MALFORMED_JSON");
    }
  } catch (reason) {
    if (timedOut) {
      throw new MlbFeedError("MLB feed request timed out.", "REQUEST_TIMEOUT");
    }
    throw reason;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
