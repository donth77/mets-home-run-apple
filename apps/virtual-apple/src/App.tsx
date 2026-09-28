import { type StadiumScoreboardData, useActuatorSimulation } from "@apple/apple-3d";
import { METS_TEAM_ID, mlbGameLabel } from "@apple/mlb-live-feed";
import { MAX_STROKE_MM, type PresentationSnapshot } from "@apple/protocol";
import { Scoreboard } from "@apple/scoreboard-ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gameStatusAnnouncement } from "./accessibilityPresentation";
import { delayWidgetLabel, isRainDelayPresentation } from "./delayPresentation";
import { demoControlsEnabled } from "./demoMode";
import { gameDateParts, nextGameLabelParts, timeZoneAbbreviation } from "./gameDateDisplay";
import { selectHomeRunPhrase } from "./homeRunPhrases";
import { LiveGamedayWidget } from "./LiveGamedayWidget";
import { MiniAppleView } from "./MiniAppleView";
import { pushNotificationsSupported } from "./notificationClient";
import { NotificationSettings } from "./NotificationSettings";
import { isStandalonePwa, PwaInstallPrompt } from "./PwaInstallPrompt";
import {
  fanFacingMoment,
  isCitiFieldVenue,
  liveBetweenGamesSnapshot,
  liveMoment,
  liveOffseasonSnapshot,
} from "./presentation";
import { RadioCompanion } from "./RadioCompanion";
import { createSharedAppleStageHost, moveSharedAppleStage, SharedAppleStage } from "./SharedAppleStage";
import { UpcomingGames } from "./UpcomingGames";
import { type CelebrationSoundCue, useCelebrationSound } from "./useCelebrationSound";
import { useDesktopViewModes } from "./useDesktopViewModes";
import { useFixturePlayback } from "./useFixturePlayback";
import { useLiveMetsGame } from "./useLiveMetsGame";
import { useNotificationSubscription } from "./useNotificationSubscription";
import { useMetsSchedule } from "./useMetsSchedule";
import { useMetsSeason } from "./useMetsSeason";
import { useMiniAppleWindow } from "./useMiniAppleWindow";
import { useMlbSeasonPhase } from "./useMlbSeasonPhase";
import { useReducedMotion } from "./useReducedMotion";
import { VictoryConfetti } from "./VictoryConfetti";
import { ViewModeControls } from "./ViewModeControls";

const modes = [
  { id: "live", label: "Live inning" },
  { id: "home-run", label: "Home run" },
  { id: "grand-slam", label: "Grand slam" },
  { id: "review-confirmed", label: "Review" },
  { id: "rain-delay", label: "Delay" },
  { id: "mets-win", label: "Mets win" },
  { id: "sleep", label: "Between games" },
  { id: "offseason", label: "Offseason" },
];

export function App() {
  const playback = useFixturePlayback("sleep");
  const seasonPhase = useMlbSeasonPhase();
  const seasonChecked = seasonPhase.status !== "CHECKING";
  const metsSeason = useMetsSeason(seasonPhase.isOffseason, seasonChecked);
  // Between seasons nothing is followed until a game, spring training
  // included, comes within the week.
  const liveEnabled = seasonChecked && (!seasonPhase.isOffseason || metsSeason.gameThisWeek);
  const live = useLiveMetsGame(liveEnabled);
  // A game just ended may have been the Mets' last: decide the season again.
  const followedGameRef = useRef(false);
  useEffect(() => {
    if (live.status === "CONNECTING" || live.status === "POLLING" || live.status === "FINAL") {
      followedGameRef.current = true;
    } else if (live.status === "BETWEEN_GAMES" && followedGameRef.current) {
      followedGameRef.current = false;
      metsSeason.recheck();
    }
  }, [live.status, metsSeason.recheck]);
  // ?diag shows what the core and the actuator are doing, for a phone that
  // misbehaves where no devtools can reach.
  const diagnostics = useMemo(() => new URLSearchParams(window.location.search).has("diag"), []);
  const reducedMotion = useReducedMotion();
  const desktopViewModes = useDesktopViewModes();
  // One subscription state for whichever surface shows: the toolbar bell on
  // desktop, the alerts card on an installed phone app.
  const notifications = useNotificationSubscription(
    pushNotificationsSupported() && (desktopViewModes || isStandalonePwa()),
  );
  const [sceneReady, setSceneReady] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const activeFocusMode = desktopViewModes && focusMode;
  const [stageHost] = useState(() => createSharedAppleStageHost(document));
  const mainStageSlot = useRef<HTMLDivElement>(null);
  const restoreStageToMain = useCallback(() => moveSharedAppleStage(stageHost, mainStageSlot.current), [stageHost]);
  const miniAppleWindow = useMiniAppleWindow(restoreStageToMain);
  useLayoutEffect(() => {
    if (!miniAppleWindow.isOpen) restoreStageToMain();
  }, [miniAppleWindow.isOpen, restoreStageToMain]);
  useEffect(() => {
    if (!desktopViewModes && focusMode) setFocusMode(false);
  }, [desktopViewModes, focusMode]);
  const showDemoControls = useMemo(
    () => demoControlsEnabled(window.location.search, import.meta.env.DEV, window.location.hostname),
    [],
  );
  const [demoOverride, setDemoOverride] = useState(() => showDemoControls && playback.scenarioId !== "sleep");
  // The Mets' season is over and no game is on show. A game still on the
  // board or a celebration holds the offseason off, and so does a win's track
  // (see `offseason` below). The live hook's own schedule checks, such as the
  // one when the tab comes back into view, pass through other statuses with
  // no game and must not blink the offseason away.
  const restingForSeason = demoOverride
    ? playback.scenarioId === "offseason"
    : metsSeason.seasonOver && (!liveEnabled || live.game === undefined) && !live.celebration;
  const liveStandby = !demoOverride && !restingForSeason && live.status === "ERROR" && !live.celebration;
  const displayPhase = demoOverride
    ? playback.activeFrame.snapshot.phase
    : restingForSeason
      ? "SLEEP"
      : liveStandby
        ? "LIVE"
        : live.celebration
          ? "CELEBRATION"
          : (live.snapshot?.phase ?? "SLEEP");
  const gameIsActive = liveStandby || ["LIVE", "REVIEW", "DELAYED", "CELEBRATION"].includes(displayPhase);
  const upcomingGames = useMetsSchedule(seasonChecked && !gameIsActive && !restingForSeason);
  const liveRestingSnapshot = useMemo(() => liveBetweenGamesSnapshot(upcomingGames[0]), [upcomingGames]);
  const sourceSnapshot = demoOverride
    ? playback.activeFrame.snapshot
    : restingForSeason
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
        : restingForSeason
          ? fanFacingMoment("offseason", sourceSnapshot, homeRunPhrase)
          : liveMoment(live.status, sourceSnapshot, live.celebration, homeRunPhrase),
    [demoOverride, homeRunPhrase, live.celebration, live.status, playback.scenarioId, restingForSeason, sourceSnapshot],
  );
  const rawPublicSnapshot = useMemo<PresentationSnapshot>(
    () => ({
      ...sourceSnapshot,
      ...(liveStandby
        ? {
            phase: "LIVE" as const,
          }
        : demoOverride || !live.celebration
          ? {}
          : { phase: "CELEBRATION" as const }),
      ...moment,
    }),
    [demoOverride, live.celebration, liveStandby, moment, sourceSnapshot],
  );
  const actuatorAnimationWindow = miniAppleWindow.animationWindow ?? window;
  const liveActuator = useActuatorSimulation(live.targetPositionMm, {
    animationWindow: actuatorAnimationWindow,
    reducedMotion,
  });
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
  // The last game's win plays its track out before the Apple rests for the season.
  const offseason = restingForSeason && (demoOverride || !celebrationSound.winTrackPlaying);
  const heldWinSnapshotRef = useRef<PresentationSnapshot | undefined>(undefined);
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
  const presentationActuator = useActuatorSimulation(presentationTargetPositionMm, {
    animationWindow: actuatorAnimationWindow,
    reducedMotion,
  });
  const appleFullyRaised = presentationActuator.positionMm >= MAX_STROKE_MM - 0.25;
  useEffect(() => {
    if (!winCelebration) {
      setWinAppleReachedTop(false);
    } else if (appleFullyRaised) {
      setWinAppleReachedTop(true);
    }
  }, [appleFullyRaised, winCelebration]);
  const betweenGames = !liveStandby && publicSnapshot.phase === "SLEEP" && !offseason;
  const gameIsFinal = publicSnapshot.phase === "FINAL";
  const metsHomeGame = sourceSnapshot.home.id === METS_TEAM_ID;
  const atCitiField = demoOverride
    ? metsHomeGame
    : offseason
      ? true
      : live.game
        ? isCitiFieldVenue(live.game.venue)
        : isCitiFieldVenue(upcomingGames[0]?.venue);
  const rainAtCitiField = rainDelay && metsHomeGame && atCitiField;
  const progress = playback.durationMs === 0 ? 0 : Math.min(100, (playback.elapsedMs / playback.durationMs) * 100);
  const nextGame: { day: string; time: string; timeSet?: boolean } = upcomingGames[0]
    ? gameDateParts(upcomingGames[0].gameDate, undefined, undefined, upcomingGames[0])
    : nextGameLabelParts(publicSnapshot.label);
  // Spring Training, NLDS Game 3 and the like, for the game on show.
  const liveGameLabel = !demoOverride && live.game ? mlbGameLabel(live.game) : undefined;
  const nextGameLabel = demoOverride ? undefined : upcomingGames[0]?.label;
  const shownGameLabel = offseason ? undefined : betweenGames ? nextGameLabel : liveGameLabel;
  const nextGameDateTime = upcomingGames[0]?.gameDate;
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const nextGameTimeZone = timeZoneAbbreviation(
    nextGameDateTime ? new Date(nextGameDateTime) : new Date(),
    browserTimeZone,
  );
  const stadiumScoreboardData = useMemo<StadiumScoreboardData>(
    () => ({
      ...publicSnapshot,
      atCitiField,
      standby: liveStandby,
      label: liveStandby ? "STANDBY" : publicSnapshot.phase === "FINAL" ? "FINAL" : publicSnapshot.label,
      batter: publicSnapshot.phase === "CELEBRATION" ? homeRunSubject : publicSnapshot.atBat?.batter,
      batterLine: publicSnapshot.atBat?.batterLine,
      pitcher: publicSnapshot.atBat?.pitcher,
      pitchCount: publicSnapshot.atBat?.pitchCount,
      gameLabel: shownGameLabel,
      nextGame:
        betweenGames && nextGame.time
          ? {
              day: nextGame.day,
              time: nextGame.timeSet === false ? "TIME TBD" : `${nextGame.time} ${nextGameTimeZone}`,
            }
          : undefined,
    }),
    [
      atCitiField,
      betweenGames,
      homeRunSubject,
      liveStandby,
      nextGame.day,
      nextGame.time,
      nextGame.timeSet,
      nextGameTimeZone,
      publicSnapshot,
      shownGameLabel,
    ],
  );
  const liveInningMoment = publicSnapshot.phase === "LIVE" && publicSnapshot.label.trim().toUpperCase() === "LIVE";
  const momentEyebrow = offseason
    ? "SEE YOU NEXT SEASON"
    : liveStandby
      ? "LIVE UPDATES"
      : liveInningMoment && liveGameLabel
        ? liveGameLabel.toUpperCase()
        : publicSnapshot.phase;
  const momentHeadline = liveStandby ? "STANDBY" : delayWidgetLabel(publicSnapshot);
  const showMomentEyebrow =
    liveInningMoment ||
    (publicSnapshot.phase !== "DELAYED" && momentEyebrow.trim().toUpperCase() !== momentHeadline.trim().toUpperCase());
  const statusAnnouncement = gameStatusAnnouncement(publicSnapshot, {
    betweenGames,
    offseason,
    standby: liveStandby,
    nextGameDay: nextGame.day,
    nextGameTime: nextGame.timeSet === false ? "a time to be announced" : nextGame.time,
    gameLabel: shownGameLabel,
  });
  const showBroadcastScoreboard = !offseason && !betweenGames && (!liveStandby || publicSnapshot.gamePk > 0);
  const soundControls = {
    enabled: celebrationSound.enabled,
    error: celebrationSound.error,
    onToggle: celebrationSound.toggle,
    supported: celebrationSound.supported,
  };

  async function playScenario(id: string) {
    celebrationSound.stop();
    if (["home-run", "grand-slam", "review-confirmed", "rain-delay", "mets-win"].includes(id)) {
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

  async function openMiniApple() {
    const opened = await miniAppleWindow.open();
    if (!opened) setFocusMode(true);
  }

  return (
    <>
      <main
        className="virtual-shell"
        data-demo-controls={showDemoControls}
        data-feed-status={liveStandby ? "standby" : "current"}
        data-focus-mode={activeFocusMode}
        data-mini-open={miniAppleWindow.isOpen}
        data-phase={liveStandby ? "STANDBY" : publicSnapshot.phase}
        data-scene-ready={miniAppleWindow.isOpen || sceneReady}
        data-weather={rainAtCitiField ? "rain" : "clear"}
      >
        {!offseason && !activeFocusMode && !miniAppleWindow.isOpen && (
          <a className="skip-link" href="#game-status">
            Skip to game status
          </a>
        )}
        <h1 className="visually-hidden">Virtual Mets Apple</h1>
        {!miniAppleWindow.isOpen && (
          <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
            {statusAnnouncement}
          </p>
        )}
        {miniAppleWindow.error && (
          <p className="view-mode-notice" role="status">
            {miniAppleWindow.error}
          </p>
        )}

        <header
          className={
            miniAppleWindow.isOpen
              ? "virtual-header virtual-header--background"
              : activeFocusMode
                ? "virtual-header virtual-header--focus"
                : "virtual-header"
          }
        >
          {!miniAppleWindow.isOpen && !activeFocusMode && (
            <div className="virtual-brand" key="brand">
              <img className="brand-logo" src="/favicon.png" alt="" />
              <div className="virtual-brand__copy">
                <strong>Virtual Apple</strong>
                <small>Citi Field</small>
              </div>
            </div>
          )}
          <div className="virtual-header__right" key="right">
            <div
              key="radio"
              className={
                activeFocusMode || miniAppleWindow.isOpen
                  ? "radio-companion-slot radio-companion-slot--hidden"
                  : "radio-companion-slot"
              }
            >
              <RadioCompanion />
            </div>
            {!miniAppleWindow.isOpen && (
              <ViewModeControls
                key="view-controls"
                desktopViewModes={desktopViewModes}
                focusMode={activeFocusMode}
                miniWindowSupported={miniAppleWindow.supported}
                notifications={notifications}
                onOpenMiniWindow={openMiniApple}
                onToggleFocusMode={() => setFocusMode((current) => !current)}
                sound={soundControls}
              />
            )}
          </div>
        </header>

        <div className="shared-apple-stage-slot" ref={mainStageSlot} />
        {miniAppleWindow.isOpen && (
          <section className="mini-open-placeholder" aria-label="Mini Apple window status">
            <img src="/favicon.png" alt="" />
            <div>
              <strong>Mini Apple is open</strong>
            </div>
            <button type="button" onClick={miniAppleWindow.close}>
              Restore
            </button>
          </section>
        )}

        {!miniAppleWindow.isOpen && showBroadcastScoreboard && (
          <div className="virtual-hud">
            <div className="virtual-scoreboard">
              <Scoreboard
                snapshot={publicSnapshot}
                announceUpdates={false}
                standby={liveStandby}
                gameLabel={liveGameLabel}
              />
            </div>
          </div>
        )}

        {!activeFocusMode && !miniAppleWindow.isOpen && !offseason && (
          <section
            id="game-status"
            className={`moment-card${liveInningMoment ? " moment-card--live" : ""}${liveStandby ? " moment-card--standby" : ""}`}
            tabIndex={-1}
          >
            {betweenGames ? (
              <div className="moment-card__next">
                <span className="moment-card__next-label">{nextGameLabel?.toUpperCase() ?? "NEXT GAME"}</span>
                <h2 className="moment-card__next-game">
                  <strong>{nextGame.day}</strong>
                  {nextGame.time && nextGame.timeSet === false ? (
                    <time dateTime={upcomingGames[0]?.officialDate}>Time TBD</time>
                  ) : (
                    nextGame.time && (
                      <time dateTime={nextGameDateTime}>
                        {nextGame.time}
                        <small className="moment-card__next-time-zone" title={browserTimeZone}>
                          <span aria-hidden="true">{nextGameTimeZone}</span>
                          <span className="visually-hidden"> {nextGameTimeZone} time zone</span>
                        </small>
                      </time>
                    )
                  )}
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
        )}

        {!activeFocusMode &&
          !miniAppleWindow.isOpen &&
          gameIsActive &&
          publicSnapshot.gamePk > 0 &&
          !winCelebration && <LiveGamedayWidget snapshot={publicSnapshot} standby={liveStandby} />}
        {!activeFocusMode && !miniAppleWindow.isOpen && !winCelebration && !gameIsFinal && (
          <UpcomingGames games={upcomingGames} />
        )}

        {showDemoControls && !activeFocusMode && !miniAppleWindow.isOpen && (
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

        {!miniAppleWindow.isOpen && (
          <>
            {!desktopViewModes && <PwaInstallPrompt />}
            {!desktopViewModes && <NotificationSettings notifications={notifications} />}
          </>
        )}
        {diagnostics && (
          <pre className="diag-overlay">
            {[
              `status ${live.status}`,
              `sequence ${live.sequenceState ?? "-"}`,
              `target ${live.targetPositionMm} mm · apple ${liveActuator.positionMm.toFixed(1)} mm`,
              `celebration ${live.celebration ? `${live.celebration.kind} ${live.celebration.subject}` : "-"}`,
              `visible ${document.visibilityState} · ${new Date().toLocaleTimeString()}`,
              live.error ? `error ${live.error}` : "",
            ]
              .filter(Boolean)
              .join("\n")}
          </pre>
        )}

        {!miniAppleWindow.isOpen && (
          <VictoryConfetti active={winCelebration && appleFullyRaised} reducedMotion={reducedMotion} />
        )}
      </main>

      <SharedAppleStage
        animationWindow={miniAppleWindow.animationWindow ?? undefined}
        host={stageHost}
        mini={miniAppleWindow.isOpen}
        onReadyChange={setSceneReady}
        positionMm={presentationActuator.positionMm}
        reducedMotion={reducedMotion}
        scoreboardData={stadiumScoreboardData}
        weather={rainAtCitiField ? "RAIN" : "CLEAR"}
      />

      {miniAppleWindow.container && (
        <MiniAppleView
          betweenGames={betweenGames}
          confettiActive={winCelebration && appleFullyRaised}
          container={miniAppleWindow.container}
          gameLabel={shownGameLabel}
          nextGame={nextGame}
          offseason={offseason}
          onReturn={miniAppleWindow.close}
          reducedMotion={reducedMotion}
          showScoreboard={showBroadcastScoreboard}
          snapshot={publicSnapshot}
          stageHost={stageHost}
          sound={soundControls}
          standby={liveStandby}
          weather={rainAtCitiField ? "RAIN" : "CLEAR"}
        />
      )}
    </>
  );
}
