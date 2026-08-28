import { Volume2, VolumeOff } from "lucide-react";

interface SceneSoundToggleProps {
  compact?: boolean;
  enabled: boolean;
  error: string;
  onToggle: () => Promise<unknown>;
  supported: boolean;
}

export function SceneSoundToggle({ compact = false, enabled, error, onToggle, supported }: SceneSoundToggleProps) {
  const SoundIcon = enabled ? Volume2 : VolumeOff;

  return (
    <button
      type="button"
      className={`celebration-sound-toggle${compact ? " celebration-sound-toggle--compact" : ""}`}
      aria-label={enabled ? "Turn scene sounds off" : "Turn scene sounds on"}
      aria-pressed={enabled}
      disabled={!supported}
      onClick={() => void onToggle()}
      title={error || "Home-run jingles, Mets-win songs, and rain ambience"}
    >
      <SoundIcon className="celebration-sound-toggle__icon" aria-hidden="true" size={20} strokeWidth={2.25} />
    </button>
  );
}
