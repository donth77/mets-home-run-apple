import { type AppleStatus, parseAppleStatus } from "./appleDevice";

// Talks to the physical Apple through the Lab dev server's /device relay
// (vite-apple-relay.ts). The host header picks which Apple; the code header
// is what the Apple's Manager checks on anything that acts.

export const DEFAULT_APPLE_HOST = "home-run-apple.local";
export type CelebrationKind = "hr" | "win";

export class AppleRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = "AppleRequestError";
  }
}

export const APPLE_ERROR_TEXT: Record<string, string> = {
  CODE: "The setup code was refused. It is on the Apple's info screen (short press of the button).",
  LOCKED: "Too many wrong codes. The Apple is ignoring codes for a minute.",
  CELEBRATING: "The Apple is already celebrating. Wait for it to come home.",
  BUSY: "The Apple is busy or still starting up. Try again in a moment.",
  NO_REPLAY: "This firmware has no test celebration.",
  RELAY: "The Apple is not reachable at that address.",
  BAD_HOST: "That address is not valid.",
};

export function describeAppleError(error: unknown): string {
  if (error instanceof AppleRequestError) return APPLE_ERROR_TEXT[error.code] ?? `The Apple answered ${error.code}.`;
  if (error instanceof Error) return error.message;
  return "Something went wrong talking to the Apple.";
}

export interface AppleClientOptions {
  host: string;
  code?: string;
  fetchImpl?: typeof fetch;
  base?: string;
}

async function readError(response: Response): Promise<AppleRequestError> {
  let code = `HTTP_${response.status}`;
  let detail: string | undefined;
  try {
    const body = (await response.json()) as { error?: unknown; detail?: unknown };
    if (typeof body.error === "string") code = body.error;
    if (typeof body.detail === "string") detail = body.detail;
  } catch {
    // Not JSON; keep the HTTP code.
  }
  return new AppleRequestError(code, response.status, detail);
}

function request(options: AppleClientOptions, path: string, init: RequestInit = {}): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = new Headers(init.headers);
  headers.set("X-Apple-Host", options.host);
  if (options.code) headers.set("X-Apple-Code", options.code);
  headers.set("Accept", "application/json");
  return fetchImpl(`${options.base ?? "/device"}${path}`, { ...init, headers, cache: "no-store" });
}

export async function fetchAppleStatus(options: AppleClientOptions): Promise<AppleStatus> {
  const response = await request(options, "/api/status");
  if (!response.ok) throw await readError(response);
  return parseAppleStatus(await response.json());
}

export async function requestAppleCelebration(options: AppleClientOptions, kind: CelebrationKind): Promise<void> {
  const response = await request(options, `/api/replay?kind=${kind}`, { method: "POST" });
  if (!response.ok) throw await readError(response);
}
