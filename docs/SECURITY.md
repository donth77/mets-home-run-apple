# Security model

This project has two distinct trust boundaries: an autonomous physical device and read-only browser applications. Virtual Apple is a static public site. Apple Lab is a local engineering tool. Neither browser app currently contains a route that can command physical motion.

## Browser data boundary

`@apple/mlb-live-feed` accepts only the configured MLB Stats API origin and uses bounded, abortable reads:

- every request has an internal deadline and forwards caller cancellation;
- response bytes are counted while streaming, before JSON allocation;
- HTTP failures, malformed JSON, invalid cursors, malformed archive indexes, and unexpected feed shapes fail closed;
- archive timestamp counts and polling intervals are capped;
- JSON Patch paths reject `__proto__`, `prototype`, and `constructor` tokens in both source and destination pointers;
- patch failures fall back to a bounded authoritative full feed instead of applying partial state;
- tests substitute synthetic `fetch` responses and never contact MLB.

Team-logo reads accept positive integer IDs, require an SVG media type, cap streamed bytes, reject script elements, omit credentials/referrers, and have an independent deadline. A failed logo is presentation-only and never affects game state.

## Device boundary

The C++ core emits motion intent but cannot touch GPIO. The future Nano adapter must enforce direction timeouts, end-stop/home checks, one sequence at a time, and a latched disabled fault. Accepted event keys are persisted before motion intent is exposed. Browser simulation, historical replay, and live recording use recording-only adapters.

A future Apple Lab device transport must be local, authenticated, versioned, and firmware-authorized. Physical service actions must additionally require an expiring maintenance lease, suspended live automation, an idle sequence, and confirmed home position. Do not implement a generic remote “raise” endpoint.

## Production response headers

Set security headers at the static host or CDN. Adapt `connect-src` if the optional same-origin edge cache replaces direct MLB reads. A suitable production starting point is:

```text
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://statsapi.mlb.com https://www.mlbstatic.com; media-src 'self' https://live.amperwave.net; font-src 'self'; worker-src 'self' blob:; upgrade-insecure-requests
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
```

The direct Audacy stream and MLB endpoints are third-party availability dependencies, not application servers. If an upstream origin changes, update this allowlist deliberately. Do not use `connect-src *` or turn the edge cache into an open proxy.

Development servers need additional allowances for hot-module reload and should not be exposed as production hosts. Production builds disable source maps by default.

## Secrets and reports

The current static apps need no API key. Never commit Wi-Fi credentials, local hostnames, signing keys, device tokens, raw diagnostic exports, or unminimized third-party game archives. Run `pnpm check:public` before publishing changes. Report a suspected vulnerability privately to the repository owner before opening a public issue containing exploit details or credentials.
