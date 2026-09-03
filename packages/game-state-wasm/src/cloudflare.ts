import createGameStateModule from "./generated/game-state.worker.mjs";
import gameStateWasm from "./generated/game-state.worker.wasm";
import { GameStateProjector } from "./index";

export function createCloudflareGameStateProjector(): Promise<GameStateProjector> {
  return GameStateProjector.create(() =>
    createGameStateModule({
      instantiateWasm(imports, successCallback) {
        const instance = new WebAssembly.Instance(gameStateWasm, imports);
        successCallback(instance, gameStateWasm);
        return instance.exports;
      },
    }),
  );
}
