import { useRef, useState } from "react";

const AUDACY_METS_STREAM_URL = "https://live.amperwave.net/direct/audacy-metsradiomp3-imc";
const AUDACY_METS_STATION_URL = "https://www.audacy.com/stations/metsradio";

function configuredStreamUrl() {
  const configured = (import.meta.env.VITE_METS_AUDIO_STREAM_URL as string | undefined)?.trim();
  if (!configured) return AUDACY_METS_STREAM_URL;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" ? url.toString() : AUDACY_METS_STREAM_URL;
  } catch {
    return AUDACY_METS_STREAM_URL;
  }
}

export function RadioCompanion() {
  const streamUrl = configuredStreamUrl();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  async function togglePlayback() {
    if (!audio.current) return;
    if (playing) {
      audio.current.pause();
      setPlaying(false);
      return;
    }

    try {
      await audio.current.play();
      setPlaying(true);
      setError("");
    } catch {
      setError("The provider blocked browser playback. Open the official player instead.");
    }
  }

  return (
    <aside className="radio-card" aria-label="Mets radio companion" aria-describedby="mets-radio-help">
      <div className="radio-card__station">
        <span className="radio-card__icon" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div>
          <span>Mets radio</span>
          <strong>Mets Radio · 880 AM</strong>
        </div>
        <span className={playing ? "radio-card__live is-live" : "radio-card__live"} role="status" aria-live="polite">
          {playing ? "ON AIR" : "READY"}
        </span>
      </div>
      {/* biome-ignore lint/a11y/useMediaCaption: Live radio has no synchronized caption track; the official provider link remains available. */}
      <audio
        id="mets-radio-stream"
        ref={audio}
        src={streamUrl}
        preload="none"
        onEnded={() => setPlaying(false)}
        onError={() => setError("The live stream is unavailable here right now.")}
      />
      <div className="radio-card__actions">
        <button
          type="button"
          className="radio-card__action"
          aria-controls="mets-radio-stream"
          aria-pressed={playing}
          onClick={togglePlayback}
        >
          {playing ? "Pause radio" : "Listen live"}
        </button>
        <a
          className="radio-card__station-link"
          href={AUDACY_METS_STATION_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Open Mets Radio on Audacy in a new tab"
        >
          Open Audacy
        </a>
      </div>
      <p
        id="mets-radio-help"
        className={`radio-card__message${error ? " radio-card__message--error" : ""}`}
        aria-live="polite"
      >
        {error || "Official free Mets Radio stream. Availability follows Audacy's regional broadcast rules."}
      </p>
    </aside>
  );
}
