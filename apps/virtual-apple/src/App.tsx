import { AppleStage, type StadiumScoreboardData, useActuatorSimulation } from "@apple/apple-3d";
import { METS_TEAM_ID } from "@apple/mlb-live-feed";
import { type GameSnapshot, MAX_STROKE_MM } from "@apple/protocol";
import { Scoreboard } from "@apple/scoreboard-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { gameStatusAnnouncement } from "./accessibilityPresentation";
import { delayWidgetLabel, isRainDelayPresentation } from "./delayPresentation";
import { demoControlsEnabled } from "./demoMode";
import { gameDateParts, nextGameLabelParts } from "./gameDateDisplay";
import { selectHomeRunPhrase } from "./homeRunPhrases";
import { LiveGamedayWidget } from "./LiveGamedayWidget";
import {
  fanFacingMoment,
  isCitiFieldVenue,
  liveBetweenGamesSnapshot,
  liveMoment,
  liveOffseasonSnapshot,
} from "./presentation";
import { RadioCompanion } from "./RadioCompanion";
import { UpcomingGames } from "./UpcomingGames";
import { type CelebrationSoundCue, useCelebrationSound } from "./useCelebrationSound";
import { useFixturePlayback } from "./useFixturePlayback";
import { useLiveMetsGame } from "./useLiveMetsGame";
import { useMetsSchedule } from "./useMetsSchedule";
import { useMlbSeasonPhase } from "./useMlbSeasonPhase";
import { useReducedMotion } from "./useReducedMotion";
import { VictoryConfetti } from "./VictoryConfetti";

const modes = [
  { id: "live", label: "Live inning" },
  { id: "home-run", label: "Home run" },
  { id: "review-confirmed", label: "Review" },
  { id: "rain-delay", label: "Delay" },
  { id: "mets-win", label: "Mets win" },
  { id: "sleep", label: "Between games" },
  { id: "offseason", label: "Offseason" },
];

export function App() {
  const playback = useFixturePlayback("sleep");
  const seasonPhase = useMlbSeasonPhase();
  const live = useLiveMetsGame(seasonPhase.status !== "CHECKING" && !seasonPhase.isOffseason);
  const reducedMotion = useReducedMotion();
  const [sceneReady, setSceneReady] = useState(false);
  const showDemoControls = useMemo(
    () => demoControlsEnabled(window.location.search, import.meta.env.DEV, window.location.hostname),
    [],
  );
  const [demoOverride, setDemoOverride] = useState(() => showDemoControls && playback.scenarioId !== "sleep");
  const offseason = demoOverride ? playback.scenarioId === "offseason" : seasonPhase.isOffseason;
  const displayPhase = demoOverride
    ? playback.activeFrame.snapshot.phase
    : offseason
      ? "SLEEP"
      : live.celebration
        ? "CELEBRATION"
        : (live.snapshot?.phase ?? "SLEEP");
  const gameIsActive = ["LIVE", "REVIEW", "DELAYED", "CELEBRATION"].includes(displayPhase);
  const upcomingGames = useMetsSchedule(seasonPhase.status !== "CHECKING" && !gameIsActive && !offseason);
  const liveRestingSnapshot = useMemo(() => liveBetweenGamesSnapshot(upcomingGames[0]), [upcomingGames]);
  const sourceSnapshot = demoOverride
    ? playback.activeFrame.snapshot
    : offseason
      ? liveOffseasonSnapshot
      : (live.snapshot ?? liveRestingSnapshot);
  const [homeRunRoll, setHomeRunRoll] = useState(() => Math.random());
  const homeRunSubject = demoOverride
    ? sourceSnapshot.atBat?.batter
    : live.celebration?.subject || sourceSnapshot.atBat?.batter;
  const homeRunPhrase = useMemo(
    () => selectHomeRunPhrase(homeRunSubject || "A Mets hitter", homeRunRoll),
    [homeRunRoll, homeRunSubject],
  );
  const moment = useMemo(
    () =>
      demoOverride
        ? fanFacingMoment(playback.scenarioId, sourceSnapshot, homeRunPhrase)
        : offseason
          ? fanFacingMoment("offseason", sourceSnapshot, homeRunPhrase)
          : liveMoment(live.status, sourceSnapshot, live.celebration, homeRunPhrase),
    [demoOverride, homeRunPhrase, live.celebration, live.status, offseason, playback.scenarioId, sourceSnapshot],
  );
  const rawPublicSnapshot = useMemo<GameSnapshot>(
    () => ({
      ...sourceSnapshot,
      ...(demoOverride || !live.celebration ? {} : { phase: "CELEBRATION" as const }),
      ...moment,
    }),
    [demoOverride, live.celebration, moment, sourceSnapshot],
  );
  const liveActuator = useActuatorSimulation(live.targetPositionMm, { reducedMotion });
  useEffect(() => {
    live.reportPosition(liveActuator.positionMm);
  }, [live.reportPosition, liveActuator.positionMm]);
  const rawCelebration = rawPublicSnapshot.phase === "CELEBRATION";
  const rawWinCelebration =
    rawCelebration && (demoOverride ? playback.scenarioId === "mets-win" : live.celebration?.kind === "METS_WIN");
  const rainDelay = isRainDelayPresentation(rawPublicSnapshot);
  const celebrationSoundCue = useMemo<CelebrationSoundCue | undefined>(
    () =>
      rawCelebration
        ? {
            id: demoOverride
              ? `demo:${playback.scenarioId}`
              : (live.celebration?.eventKey ?? `${rawPublicSnapshot.gamePk}:${rawPublicSnapshot.label}`),
            kind: rawWinCelebration ? "METS_WIN" : "HOME_RUN",
          }
        : undefined,
    [
      demoOverride,
      live.celebration?.eventKey,
      playback.scenarioId,
      rawCelebration,
      rawPublicSnapshot.gamePk,
      rawPublicSnapshot.label,
      rawWinCelebration,
    ],
  );
  const celebrationSound = useCelebrationSound(celebrationSoundCue, rainDelay);
  const heldWinSnapshotRef = useRef<GameSnapshot | undefined>(undefined);
  useEffect(() => {
    if (rawWinCelebration) heldWinSnapshotRef.current = rawPublicSnapshot;
  }, [rawPublicSnapshot, rawWinCelebration]);
  const holdingCompletedWin = celebrationSound.winTrackPlaying && heldWinSnapshotRef.current !== undefined;
  const publicSnapshot =
    holdingCompletedWin && !rawWinCelebration ? (heldWinSnapshotRef.current ?? rawPublicSnapshot) : rawPublicSnapshot;
  const winCelebration = rawWinCelebration || holdingCompletedWin;
  const underlyingPresentationTargetMm = demoOverride ? playback.activeFrame.positionMm : live.targetPositionMm;
  const [winAppleReachedTop, setWinAppleReachedTop] = useState(false);
  const holdWinAppleRaised = winCelebration && celebrationSound.winTrackPlaying && winAppleReachedTop;
  const presentationTargetPositionMm = holdWinAppleRaised ? MAX_STROKE_MM : underlyingPresentationTargetMm;
  const presentationActuator = useActuatorSimulation(presentationTargetPositionMm, { reducedMotion });
  const appleFullyRaised = presentationActuator.positionMm >= MAX_STROKE_MM - 0.25;
  useEffect(() => {
    if (!winCelebration) {
      setWinAppleReachedTop(false);
    } else if (appleFullyRaised) {
      setWinAppleReachedTop(true);
    }
  }, [appleFullyRaised, winCelebration]);
  const betweenGames = publicSnapshot.phase === "SLEEP" && !offseason;
  const atCitiField = demoOverride
    ? sourceSnapshot.home.id === METS_TEAM_ID
    : offseason
      ? true
      : live.game
        ? isCitiFieldVenue(live.game.venue)
        : isCitiFieldVenue(upcomingGames[0]?.venue);
  const progress = playback.durationMs === 0 ? 0 : Math.min(100, (playback.elapsedMs / playback.durationMs) * 100);
  const nextGame = upcomingGames[0]
    ? gameDateParts(upcomingGames[0].gameDate)
    : nextGameLabelParts(publicSnapshot.label);
  const nextGameDateTime = upcomingGames[0]?.gameDate;
  const stadiumScoreboardData = useMemo<StadiumScoreboardData>(
    () => ({
      ...publicSnapshot,
      atCitiField,
      label: publicSnapshot.phase === "FINAL" ? "FINAL" : publicSnapshot.label,
      batter: publicSnapshot.atBat?.batter,
      batterLine: publicSnapshot.atBat?.batterLine,
      pitcher: publicSnapshot.atBat?.pitcher,
      pitchCount: publicSnapshot.atBat?.pitchCount,
      nextGame: betweenGames && nextGame.time ? { day: nextGame.day, time: nextGame.time } : undefined,
    }),
    [atCitiField, betweenGames, nextGame.day, nextGame.time, publicSnapshot],
  );
  const liveInningMoment = publicSnapshot.phase === "LIVE" && publicSnapshot.label.trim().toUpperCase() === "LIVE";
  const momentEyebrow = offseason ? "SEE YOU NEXT SEASON" : publicSnapshot.phase;
  const momentHeadline = delayWidgetLabel(publicSnapshot);
  const showMomentEyebrow =
    liveInningMoment ||
    (publicSnapshot.phase !== "DELAYED" && momentEyebrow.trim().toUpperCase() !== momentHeadline.trim().toUpperCase());
  const statusAnnouncement = gameStatusAnnouncement(publicSnapshot, {
    betweenGames,
    offseason,
    nextGameDay: nextGame.day,
    nextGameTime: nextGame.time,
  });

  async function playScenario(id: string) {
    celebrationSound.stop();
    if (["home-run", "review-confirmed", "rain-delay", "mets-win"].includes(id)) {
      await celebrationSound.enable();
    }
    if (id === "home-run") setHomeRunRoll(Math.random());
    setDemoOverride(true);
    playback.play(id);
  }

  function returnToLiveData() {
    celebrationSound.stop();
    playback.setPlaying(false);
    setDemoOverride(false);
  }

  return (
    <main
      className="virtual-shell"
      data-demo-controls={showDemoControls}
      data-phase={publicSnapshot.phase}
      data-scene-ready={sceneReady}
      data-weather={rainDelay ? "rain" : "clear"}
    >
      <a className="skip-link" href="#game-status">
        Skip to game status
      </a>
      <h1 className="visually-hidden">Virtual Apple</h1>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {statusAnnouncement}
      </p>
      <AppleStage
        mode="outfield"
        positionMm={presentationActuator.positionMm}
        reducedMotion={reducedMotion}
        weather={rainDelay ? "RAIN" : "CLEAR"}
        onReadyChange={setSceneReady}
        scoreboardData={stadiumScoreboardData}
      />

      <header className="virtual-header">
        <div className="virtual-brand">
          <img className="brand-logo" src="/favicon.png" alt="" />
          <div>
            <strong>Virtual Apple</strong>
            <small>Citi Field · center field</small>
          </div>
          <button
            type="button"
            className="celebration-sound-toggle"
            aria-label={celebrationSound.enabled ? "Turn scene sounds off" : "Turn scene sounds on"}
            aria-pressed={celebrationSound.enabled}
            disabled={!celebrationSound.supported}
            onClick={() => void celebrationSound.toggle()}
            title={celebrationSound.error || "Home-run jingles, Mets-win songs, and rain ambience"}
          >
            <span className="celebration-sound-toggle__meter" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{celebrationSound.enabled ? "Sound on" : "Sound off"}</span>
          </button>
        </div>
        <RadioCompanion />
      </header>

      {!offseason && !betweenGames && (
        <div className="virtual-hud">
          <div className="virtual-scoreboard">
            <Scoreboard snapshot={publicSnapshot} announceUpdates={false} />
          </div>
        </div>
      )}

      {gameIsActive && !winCelebration && <LiveGamedayWidget snapshot={publicSnapshot} />}
      {!winCelebration && <UpcomingGames games={upcomingGames} />}

      <section id="game-status" className={`moment-card${liveInningMoment ? " moment-card--live" : ""}`} tabIndex={-1}>
        {betweenGames ? (
          <div className="moment-card__next">
            <span className="moment-card__next-label">NEXT GAME</span>
            <h2 className="moment-card__next-game">
              <strong>{nextGame.day}</strong>
              {nextGame.time && <time dateTime={nextGameDateTime}>{nextGame.time}</time>}
            </h2>
          </div>
        ) : (
          <>
            {showMomentEyebrow && <span>{momentEyebrow}</span>}
            {!liveInningMoment && <h2>{momentHeadline}</h2>}
          </>
        )}
        {!betweenGames && <p>{publicSnapshot.lastEvent}</p>}
      </section>

      {showDemoControls && (
        <nav className="virtual-controls" aria-label="Virtual Apple demo scenes">
          <div className="control-label">
            <span>Demo</span>
          </div>
          <div className="mode-list">
            <button
              type="button"
              className={demoOverride ? "" : "is-active"}
              aria-pressed={!demoOverride}
              onClick={returnToLiveData}
            >
              Live data
            </button>
            {modes.map((mode) => (
              <button
                type="button"
                key={mode.id}
                className={demoOverride && playback.scenarioId === mode.id ? "is-active" : ""}
                aria-pressed={demoOverride && playback.scenarioId === mode.id}
                onClick={() => void playScenario(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <button type="button" className="celebrate-button" onClick={() => void playScenario("home-run")}>
            Raise the Apple
          </button>
          {demoOverride && (
            <div
              className="playback-progress"
              role="progressbar"
              aria-label="Demo playback progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          )}
        </nav>
      )}

      <VictoryConfetti active={winCelebration && appleFullyRaised} reducedMotion={reducedMotion} />
    </main>
  );
}
