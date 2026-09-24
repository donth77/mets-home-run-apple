import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(resolve(process.cwd(), "../../public/virtual-apple-sw.js"), "utf8");
const origin = "https://metsapple.com";

function windowClient(url: string) {
  return { url, focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) };
}

async function clickNotification(clients: ReturnType<typeof windowClient>[], url = "/") {
  const listeners = new Map<string, (event: unknown) => void>();
  const openWindow = vi.fn(async () => undefined);
  runInNewContext(workerSource, {
    URL,
    self: {
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      clients: { matchAll: async () => clients, openWindow },
      location: new URL(`${origin}/virtual-apple-sw.js`),
      registration: { showNotification: vi.fn() },
    },
  });
  let work: Promise<unknown> | undefined;
  listeners.get("notificationclick")?.({
    notification: { close: vi.fn(), data: { url } },
    waitUntil: (promise: Promise<unknown>) => {
      work = promise;
    },
  });
  await work;
  return { openWindow };
}

describe("notification clicks", () => {
  it("brings forward a tab already on the page without reloading it", async () => {
    const miniApple = windowClient("about:blank");
    const page = windowClient(`${origin}/?diag`);

    const { openWindow } = await clickNotification([miniApple, page]);

    expect(page.focus).toHaveBeenCalledOnce();
    expect(page.navigate).not.toHaveBeenCalled();
    expect(miniApple.focus).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("prefers a tab on the page to one elsewhere on the site", async () => {
    const setup = windowClient(`${origin}/setup/`);
    const page = windowClient(`${origin}/`);

    await clickNotification([setup, page]);

    expect(page.focus).toHaveBeenCalledOnce();
    expect(setup.navigate).not.toHaveBeenCalled();
    expect(setup.focus).not.toHaveBeenCalled();
  });

  it("moves a tab elsewhere on the site to the page", async () => {
    const setup = windowClient(`${origin}/setup/`);

    await clickNotification([setup]);

    expect(setup.navigate).toHaveBeenCalledWith(`${origin}/`);
    expect(setup.focus).toHaveBeenCalledOnce();
  });

  it("opens the page when no tab is open", async () => {
    const { openWindow } = await clickNotification([]);

    expect(openWindow).toHaveBeenCalledWith(`${origin}/`);
  });
});
