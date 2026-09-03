import createAppleCoreModule from "./generated/apple-core.worker.mjs";
import appleCoreWasm from "./generated/apple-core.worker.wasm";
import { GameCore } from "./index";

export function createCloudflareGameCore(): Promise<GameCore> {
  return GameCore.create(() =>
    createAppleCoreModule({
      instantiateWasm(imports, successCallback) {
        const instance = new WebAssembly.Instance(appleCoreWasm, imports);
        successCallback(instance, appleCoreWasm);
        return instance.exports;
      },
    }),
  );
}
