import { PictureInPicture } from "lucide-react";
import { SceneSoundToggle } from "./SceneSoundToggle";

interface ViewModeControlsProps {
  desktopViewModes: boolean;
  focusMode: boolean;
  miniWindowSupported: boolean;
  onOpenMiniWindow: () => Promise<unknown>;
  onToggleFocusMode: () => void;
  sound: {
    enabled: boolean;
    error: string;
    onToggle: () => Promise<unknown>;
    supported: boolean;
  };
}

export function ViewModeControls({
  desktopViewModes,
  focusMode,
  miniWindowSupported,
  onOpenMiniWindow,
  onToggleFocusMode,
  sound,
}: ViewModeControlsProps) {
  if (focusMode) {
    return (
      <fieldset className="virtual-view-controls virtual-view-controls--focus">
        <legend className="visually-hidden">View options</legend>
        <button
          type="button"
          className="view-mode-button view-mode-button--icon"
          aria-label="Exit Focus view"
          aria-pressed={true}
          onClick={onToggleFocusMode}
          title="Exit Focus view"
        >
          <span className="view-mode-button__focus-icon" aria-hidden="true" />
        </button>
      </fieldset>
    );
  }

  return (
    <fieldset className="virtual-view-controls">
      <legend className="visually-hidden">View options</legend>
      <SceneSoundToggle {...sound} />
      {desktopViewModes && (
        <button
          type="button"
          className="view-mode-button view-mode-button--icon"
          aria-label="Enter Focus view"
          aria-pressed={false}
          onClick={onToggleFocusMode}
          title="Focus view"
        >
          <span className="view-mode-button__focus-icon" aria-hidden="true" />
        </button>
      )}
      {desktopViewModes && miniWindowSupported && (
        <button
          type="button"
          className="view-mode-button view-mode-button--icon"
          aria-label="Open Mini Apple"
          onClick={() => void onOpenMiniWindow()}
          title="Open Mini Apple"
        >
          <PictureInPicture aria-hidden="true" size={18} strokeWidth={2.25} />
        </button>
      )}
    </fieldset>
  );
}
