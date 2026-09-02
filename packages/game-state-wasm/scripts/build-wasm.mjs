import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const outputDirectory = resolve(packageRoot, "src/generated");
const outputFile = resolve(outputDirectory, "game-state.mjs");
const cacheDirectory = resolve(repositoryRoot, ".cache/emscripten");
const stateRoot = resolve(repositoryRoot, "firmware/lib/game_state");

await mkdir(outputDirectory, { recursive: true });
await mkdir(cacheDirectory, { recursive: true });

const environment = { ...process.env };
const brew = spawnSync("brew", ["--prefix", "emscripten"], { encoding: "utf8" });
if (brew.status === 0) {
  const prefix = brew.stdout.trim();
  const homebrewPython = spawnSync("brew", ["--prefix", "python@3.14"], { encoding: "utf8" });
  const configFile = resolve(cacheDirectory, "homebrew.config.py");
  await writeFile(
    configFile,
    [
      `LLVM_ROOT = '${resolve(prefix, "libexec/llvm/bin")}'`,
      `BINARYEN_ROOT = '${resolve(prefix, "libexec/binaryen")}'`,
      `NODE_JS = '${process.execPath}'`,
      "",
    ].join("\n"),
  );
  environment.EM_CONFIG = configFile;
  if (homebrewPython.status === 0) {
    environment.EMSDK_PYTHON = resolve(homebrewPython.stdout.trim(), "bin/python3.14");
  }
}

const exportedFunctions = [
  "_malloc",
  "_free",
  "_apple_game_state_create",
  "_apple_game_state_destroy",
  "_apple_game_state_begin_frame",
  "_apple_game_state_set_context",
  "_apple_game_state_set_at_bat",
  "_apple_game_state_set_linescore_totals",
  "_apple_game_state_add_inning",
  "_apple_game_state_add_play",
  "_apple_game_state_commit",
  "_apple_game_state_last_error",
  "_apple_game_state_snapshot_json",
  "_apple_game_state_decision_json",
];

const compiler = process.env.EMXX ?? "em++";
const result = spawnSync(
  compiler,
  [
    resolve(packageRoot, "src/c_api.cpp"),
    resolve(stateRoot, "src/projector.cpp"),
    `-I${resolve(stateRoot, "include")}`,
    "-std=c++17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Wpedantic",
    "-Werror",
    "--no-entry",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sSINGLE_FILE=1",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sENVIRONMENT=web,worker",
    "-sFILESYSTEM=0",
    `-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
    "-sEXPORTED_RUNTIME_METHODS=['UTF8ToString','stringToUTF8','lengthBytesUTF8']",
    "-o",
    outputFile,
  ],
  { cwd: repositoryRoot, encoding: "utf8", env: environment },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`Built ${outputFile.replace(`${repositoryRoot}/`, "")}`);
