import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

async function source(relativePath) {
  return readFile(new URL(relativePath, `file://${repositoryRoot}/`), "utf8");
}

function numericConstant(contents, name) {
  const match = contents.match(new RegExp(`\\b${name}\\s*=\\s*([0-9][0-9_'\\s]*)[;\\n]`));
  if (!match) throw new Error(`Could not find numeric constant ${name}.`);
  return Number(match[1].replaceAll(/[_'\\s]/g, ""));
}

const [coreTypes, protocol, actuator, mlbConstants] = await Promise.all([
  source("firmware/lib/core/include/apple/core/types.hpp"),
  source("packages/protocol/src/index.ts"),
  source("packages/apple-3d/src/actuatorPhysics.ts"),
  source("packages/mlb-live-feed/src/constants.ts"),
]);

const checks = [
  ["Mets team ID", numericConstant(coreTypes, "kMetsTeamId"), numericConstant(mlbConstants, "METS_TEAM_ID")],
  ["maximum stroke", numericConstant(coreTypes, "kMaxStrokeMm"), numericConstant(protocol, "MAX_STROKE_MM")],
  [
    "celebration lead-in",
    numericConstant(coreTypes, "kCelebrationLeadInMs"),
    numericConstant(actuator, "HOME_RUN_DISPLAY_LEAD_IN_MS"),
  ],
  [
    "motion deadline",
    numericConstant(coreTypes, "kMotionDeadlineMs"),
    numericConstant(actuator, "ACTUATOR_DIRECTION_TIMEOUT_MS"),
  ],
  [
    "home-run raised dwell",
    numericConstant(coreTypes, "kRaisedDwellMs"),
    numericConstant(actuator, "HOME_RUN_RAISED_DWELL_MS"),
  ],
  ["win raised dwell", numericConstant(coreTypes, "kRaisedDwellMs"), numericConstant(actuator, "WIN_RAISED_DWELL_MS")],
];

const mismatches = checks.filter(([, canonical, consumer]) => canonical !== consumer);
if (mismatches.length > 0) {
  throw new Error(
    `Core constant parity failed:\n${mismatches
      .map(([label, canonical, consumer]) => `- ${label}: C++=${canonical}, web=${consumer}`)
      .join("\n")}`,
  );
}

console.log(`Core constant parity passed (${checks.length} values).`);
