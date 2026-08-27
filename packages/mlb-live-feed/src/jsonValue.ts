export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function objectAt(value: unknown, key: string): JsonObject | undefined {
  if (!isObject(value) || !Object.hasOwn(value, key)) return undefined;
  const child = value[key];
  return isObject(child) ? child : undefined;
}

export function arrayAt(value: unknown, key: string): readonly unknown[] {
  if (!isObject(value) || !Object.hasOwn(value, key)) return [];
  return Array.isArray(value[key]) ? value[key] : [];
}

export function stringAt(value: unknown, key: string, fallback = ""): string {
  if (!isObject(value) || !Object.hasOwn(value, key)) return fallback;
  return typeof value[key] === "string" ? value[key] : fallback;
}

export function numberAt(value: unknown, key: string, fallback = 0): number {
  if (!isObject(value) || !Object.hasOwn(value, key)) return fallback;
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
}

export function optionalNumberAt(value: unknown, key: string): number | undefined {
  if (!isObject(value) || !Object.hasOwn(value, key)) return undefined;
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

export function booleanAt(value: unknown, key: string, fallback = false): boolean {
  if (!isObject(value) || !Object.hasOwn(value, key)) return fallback;
  return typeof value[key] === "boolean" ? value[key] : fallback;
}

export function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
