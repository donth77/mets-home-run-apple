import { localDebugEnabled } from "@apple/web-debug";

export function demoControlsEnabled(search: string, isDevelopment: boolean, hostname: string) {
  return localDebugEnabled(search, isDevelopment, hostname);
}
