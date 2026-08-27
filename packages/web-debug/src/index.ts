const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function isLoopbackHostname(hostname: string) {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

export function localDebugEnabled(search: string, isDevelopment: boolean, hostname: string) {
  if (!isDevelopment || !isLoopbackHostname(hostname)) return false;

  const parameters = new URLSearchParams(search);
  const values = ["demo", "debug"].filter((name) => parameters.has(name)).map((name) => parameters.get(name) ?? "");
  if (values.length === 0) return false;
  return values.some((value) => !FALSE_VALUES.has(value.trim().toLowerCase()));
}
