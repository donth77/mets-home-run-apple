import { Download } from "lucide-react";
import { useEffect, useState } from "react";

const STANDALONE_DISPLAY_QUERY = "(display-mode: standalone)";

export type InstallPlatform = "ios" | "android" | "other";

/**
 * Which manual install steps apply. iPadOS presents itself as a Mac, so a
 * "Macintosh" with a touch screen is an iPad.
 */
export function installPlatform(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = window.navigator): InstallPlatform {
  const agent = nav.userAgent;
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && nav.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(agent)) return "android";
  return "other";
}

const MANUAL_INSTALL_INSTRUCTIONS: Record<InstallPlatform, string> = {
  ios: "Tap Share, then Add to Home Screen.",
  android: "Open the browser menu and choose Add to Home screen.",
  other: "Open your browser's Share sheet or menu and choose Add to Home Screen.",
};

const LATER_INSTRUCTIONS: Record<InstallPlatform, string> = {
  ios: "You can add Virtual Apple later from the Share sheet.",
  android: "You can add Virtual Apple later from the browser menu.",
  other: "You can add Virtual Apple later from your browser's Share sheet or menu.",
};

type InstallPromptOutcome = "accepted" | "dismissed";

interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: InstallPromptOutcome }>;
}

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

export function isStandalonePwa() {
  return (
    (window.matchMedia?.(STANDALONE_DISPLAY_QUERY).matches ?? false) ||
    Boolean((window.navigator as NavigatorWithStandalone).standalone)
  );
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent>();
  const [installed, setInstalled] = useState(isStandalonePwa);
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    const displayMode = window.matchMedia?.(STANDALONE_DISPLAY_QUERY);
    const handleDisplayModeChange = () => setInstalled(isStandalonePwa());
    const handleInstallAvailable = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as InstallPromptEvent);
      setInstructions("");
    };
    const handleInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(undefined);
      setInstructions("");
    };

    displayMode?.addEventListener("change", handleDisplayModeChange);
    window.addEventListener("beforeinstallprompt", handleInstallAvailable);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      displayMode?.removeEventListener("change", handleDisplayModeChange);
      window.removeEventListener("beforeinstallprompt", handleInstallAvailable);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (installed) return null;

  async function install() {
    if (!deferredPrompt) {
      setInstructions(MANUAL_INSTALL_INSTRUCTIONS[installPlatform()]);
      return;
    }

    const prompt = deferredPrompt;
    setDeferredPrompt(undefined);
    try {
      const choice = await prompt.prompt();
      if (choice.outcome === "accepted") {
        setInstalled(true);
        return;
      }
      setInstructions(LATER_INSTRUCTIONS[installPlatform()]);
    } catch {
      setInstructions(MANUAL_INSTALL_INSTRUCTIONS[installPlatform()]);
    }
  }

  return (
    <section className="pwa-install" aria-labelledby="pwa-install-title">
      <div className="pwa-install__identity">
        <img src="/favicon.png" alt="" width="40" height="40" />
        <div>
          <strong id="pwa-install-title">Get Mets alerts</strong>
          <span>Add Virtual Apple, then turn on home run and Mets win alerts.</span>
        </div>
      </div>
      <button type="button" onClick={() => void install()}>
        <Download aria-hidden="true" strokeWidth={2.25} />
        Add to home screen
      </button>
      {instructions && (
        <p role="status" aria-live="polite">
          {instructions}
        </p>
      )}
    </section>
  );
}
