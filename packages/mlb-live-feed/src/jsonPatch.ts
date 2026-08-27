import { isObject } from "./jsonValue";

const FORBIDDEN_POINTER_TOKENS = new Set(["__proto__", "constructor", "prototype"]);

function decodePointerToken(token: string) {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pointerParts(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new Error("Invalid JSON pointer");
  const parts = path.slice(1).split("/").map(decodePointerToken);
  if (parts.some((part) => FORBIDDEN_POINTER_TOKENS.has(part))) {
    throw new Error("Unsafe JSON pointer token");
  }
  return parts;
}

function parentAtPointer(root: unknown, parts: readonly string[]) {
  let current = root;
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error("Invalid array pointer");
      }
      current = current[index];
    } else if (isObject(current) && Object.hasOwn(current, part)) {
      current = current[part];
    } else {
      throw new Error("Invalid object pointer");
    }
  }
  return { parent: current, key: parts.at(-1) ?? "" };
}

function valueAtPointer(root: unknown, path: string): unknown {
  const parts = pointerParts(path);
  let current = root;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error("Patch source is missing");
      }
      current = current[index];
    } else if (isObject(current) && Object.hasOwn(current, part)) {
      current = current[part];
    } else {
      throw new Error("Patch source is missing");
    }
  }
  return current;
}

function replaceAtPointer(root: unknown, path: string, value: unknown, add: boolean) {
  const parts = pointerParts(path);
  if (parts.length === 0) return structuredClone(value);
  const { parent, key } = parentAtPointer(root, parts);
  if (Array.isArray(parent)) {
    if (key === "-" && add) {
      parent.push(structuredClone(value));
      return root;
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new Error("Invalid array index");
    }
    if (add) parent.splice(index, 0, structuredClone(value));
    else if (index < parent.length) parent[index] = structuredClone(value);
    else throw new Error("Replace target missing");
  } else if (isObject(parent)) {
    if (!add && !Object.hasOwn(parent, key)) throw new Error("Replace target missing");
    parent[key] = structuredClone(value);
  } else {
    throw new Error("Patch parent is not a container");
  }
  return root;
}

function removeAtPointer(root: unknown, path: string) {
  const parts = pointerParts(path);
  if (parts.length === 0) throw new Error("Cannot remove document root");
  const { parent, key } = parentAtPointer(root, parts);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error("Remove target missing");
    }
    parent.splice(index, 1);
  } else if (isObject(parent) && Object.hasOwn(parent, key)) {
    delete parent[key];
  } else {
    throw new Error("Remove target missing");
  }
  return root;
}

export function applyJsonPatch(document: unknown, patch: unknown): unknown {
  if (!Array.isArray(patch)) throw new Error("Patch must be an array");
  let result = structuredClone(document);
  for (const operation of patch) {
    if (!isObject(operation)) throw new Error("Patch operation must be an object");
    const op = operation.op;
    const path = operation.path;
    if (typeof op !== "string" || typeof path !== "string") {
      throw new Error("Patch operation omitted its operation or path");
    }
    if (op === "add") result = replaceAtPointer(result, path, operation.value, true);
    else if (op === "replace") result = replaceAtPointer(result, path, operation.value, false);
    else if (op === "remove") result = removeAtPointer(result, path);
    else if (op === "copy") {
      if (typeof operation.from !== "string") throw new Error("Copy operation omitted its source pointer");
      result = replaceAtPointer(result, path, valueAtPointer(result, operation.from), true);
    } else throw new Error(`Unsupported JSON patch operation: ${op}`);
  }
  return result;
}
