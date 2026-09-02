import { GameCore } from "@apple/game-core-wasm";
import { MlbRecordingClient } from "@apple/mlb-live-feed";

/** Recording-only C++ runtime used by Apple Lab's direct MLB sources. */
export interface AppleLabMlbRuntime {
  readonly client: MlbRecordingClient;
  readonly core: GameCore;
  dispose(): void;
}

export async function createAppleLabMlbRuntime(
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<AppleLabMlbRuntime> {
  const { GameStateProjector } = await import("@apple/game-state-wasm");
  const gameState = await GameStateProjector.create();
  let core: GameCore;
  try {
    core = await GameCore.create();
  } catch (reason) {
    gameState.dispose();
    throw reason;
  }

  const client = new MlbRecordingClient(fetcher, now, (frame) => gameState.project(frame));
  let disposed = false;
  return {
    client,
    core,
    dispose() {
      if (disposed) return;
      disposed = true;
      client.reset();
      core.dispose();
      gameState.dispose();
    },
  };
}
