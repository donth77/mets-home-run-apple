import { Download } from "lucide-react";
import { useEffect, useState } from "react";

const STANDALONE_DISPLAY_QUERY = "(display-mode: standalone)";
const MANUAL_INSTALL_INSTRUCTIONS =
  "On iPhone or iPad, tap Share, then Add to Home Screen. On Android, open the browser menu and choose Add to Home screen.";

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
      setInstructions(MANUAL_INSTALL_INSTRUCTIONS);
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
      setInstructions("You can add Virtual Apple later from your browser's Share sheet or menu.");
    } catch {
      setInstructions(MANUAL_INSTALL_INSTRUCTIONS);
    }
  }

  return (
    <section className="pwa-install" aria-labelledby="pwa-install-title">
      <div className="pwa-install__identity">
        <img src="/favicon.png" alt="" width="40" height="40" />
        <div>
          <strong id="pwa-install-title">Keep Virtual Apple handy</strong>
          <span>Open it from your home screen.</span>
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
