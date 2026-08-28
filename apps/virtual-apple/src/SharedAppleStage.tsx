import { AppleStage, type StadiumScoreboardData } from "@apple/apple-3d";
import { createPortal } from "react-dom";

export function createSharedAppleStageHost(ownerDocument: Document) {
  const host = ownerDocument.createElement("div");
  host.className = "shared-apple-stage-host";
  return host;
}

export function moveSharedAppleStage(host: HTMLElement, target: HTMLElement | null) {
  if (target && host.parentElement !== target) target.append(host);
}

interface SharedAppleStageProps {
  host: HTMLElement;
  mini: boolean;
  onReadyChange: (ready: boolean) => void;
  positionMm: number;
  reducedMotion: boolean;
  scoreboardData: StadiumScoreboardData;
  weather: "CLEAR" | "RAIN";
}

export function SharedAppleStage({
  host,
  mini,
  onReadyChange,
  positionMm,
  reducedMotion,
  scoreboardData,
  weather,
}: SharedAppleStageProps) {
  return createPortal(
    <AppleStage
      className={mini ? "mini-apple-stage" : ""}
      framing={mini ? "mini" : "default"}
      mode="outfield"
      onReadyChange={onReadyChange}
      positionMm={positionMm}
      reducedMotion={reducedMotion}
      scoreboardData={scoreboardData}
      weather={weather}
    />,
    host,
  );
}
