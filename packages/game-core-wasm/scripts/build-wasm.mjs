import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const outputDirectory = resolve(packageRoot, "src/generated");
const browserOutputFile = resolve(outputDirectory, "apple-core.mjs");
const workerOutputFile = resolve(outputDirectory, "apple-core.worker.mjs");
const cacheDirectory = resolve(repositoryRoot, ".cache/emscripten");

await mkdir(outputDirectory, { recursive: true });
await mkdir(cacheDirectory, { recursive: true });

const environment = { ...process.env };
const brew = spawnSync("brew", ["--prefix", "emscripten"], {
  encoding: "utf8",
});
if (brew.status === 0) {
  const prefix = brew.stdout.trim();
  const homebrewPython = spawnSync("brew", ["--prefix", "python@3.14"], {
    encoding: "utf8",
  });
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
  "_apple_core_create",
  "_apple_core_destroy",
  "_apple_core_begin_input",
  "_apple_core_add_play",
  "_apple_core_commit_input",
  "_apple_core_tick",
  "_apple_core_report_position",
  "_apple_core_set_ledger_failures",
  "_apple_core_ledger_contains",
  "_apple_core_sequence_state",
  "_apple_core_fault_latched",
  "_apple_core_event_count",
  "_apple_core_event_type",
  "_apple_core_event_key",
  "_apple_core_event_celebration",
  "_apple_core_event_subject",
  "_apple_core_command_count",
  "_apple_core_command_type",
  "_apple_core_command_event_key",
  "_apple_core_command_position_mm",
  "_apple_core_command_deadline_ms",
  "_apple_core_trace_count",
  "_apple_core_trace_code",
  "_apple_core_trace_detail",
];

const compiler = process.env.EMXX ?? "em++";
const commonArguments = [
    resolve(packageRoot, "src/c_api.cpp"),
    resolve(repositoryRoot, "firmware/lib/core/src/engine.cpp"),
    resolve(repositoryRoot, "firmware/lib/core/src/names.cpp"),
    `-I${resolve(repositoryRoot, "firmware/lib/core/include")}`,
    "-std=c++17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Wpedantic",
    "-Werror",
    "--no-entry",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sENVIRONMENT=web,worker",
    "-sFILESYSTEM=0",
    `-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
    "-sEXPORTED_RUNTIME_METHODS=['UTF8ToString','stringToUTF8','lengthBytesUTF8']",
];

for (const [outputFile, extraArguments] of [
  [browserOutputFile, ["-sSINGLE_FILE=1"]],
  [workerOutputFile, ["-sINCOMING_MODULE_JS_API=['instantiateWasm']"]],
]) {
  const result = spawnSync(compiler, [...commonArguments, ...extraArguments, "-o", outputFile], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environment,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  console.log(`Built ${outputFile.replace(`${repositoryRoot}/`, "")}`);
}
