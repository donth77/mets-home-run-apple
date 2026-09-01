import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const outputDirectory = resolve(packageRoot, "src/generated");
const outputFile = resolve(outputDirectory, "device-display.mjs");
const cacheDirectory = resolve(repositoryRoot, ".cache/emscripten");
const rendererRoot = resolve(repositoryRoot, "firmware/lib/home_run_loop");

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
  "_apple_display_create",
  "_apple_display_destroy",
  "_apple_display_begin_home_run",
  "_apple_display_begin_mets_win",
  "_apple_display_render",
  "_apple_display_render_key",
  "_apple_display_loop_ms",
  "_apple_display_framebuffer",
];

const compiler = process.env.EMXX ?? "em++";
const result = spawnSync(
  compiler,
  [
    resolve(packageRoot, "src/c_api.cpp"),
    resolve(rendererRoot, "src/display_grid.cpp"),
    resolve(rendererRoot, "src/text_engine.cpp"),
    resolve(rendererRoot, "src/home_run_loop.cpp"),
    resolve(rendererRoot, "src/mets_win_loop.cpp"),
    `-I${resolve(rendererRoot, "include")}`,
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
    "-sEXPORTED_RUNTIME_METHODS=['UTF8ToString','stringToUTF8','lengthBytesUTF8','HEAPU16']",
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
