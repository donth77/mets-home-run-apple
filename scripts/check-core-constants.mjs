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

function stringConstant(contents, name) {
  const match = contents.match(new RegExp(`\\b${name}(?:\\[\\])?\\s*=\\s*((?:\\s*"[^"]*"\\s*\\+?)+);`));
  if (!match) throw new Error(`Could not find string constant ${name}.`);
  return [...match[1].matchAll(/"([^"]*)"/g)].map(([, part]) => part).join("");
}

const [coreTypes, protocolCore, actuator, mlbConstants, nanoFeed] = await Promise.all([
  source("firmware/lib/core/include/apple/core/types.hpp"),
  source("packages/protocol/src/core.ts"),
  source("packages/apple-3d/src/actuatorPhysics.ts"),
  source("packages/mlb-live-feed/src/constants.ts"),
  source("firmware/lib/mlb_feed/src/feed.cpp"),
]);

// The browser normalizer reads more of the feed than the Nano extractor, so
// its field list must contain every name the Nano asks for.
const browserFields = new Set(stringConstant(mlbConstants, "LIVE_FEED_FIELDS").split(","));
const missingFields = stringConstant(nanoFeed, "kLiveFeedFields")
  .split(",")
  .filter((name) => !browserFields.has(name));
if (missingFields.length > 0) {
  throw new Error(`LIVE_FEED_FIELDS is missing Nano feed fields: ${missingFields.join(", ")}`);
}

const checks = [
  ["Mets team ID", numericConstant(coreTypes, "kMetsTeamId"), numericConstant(mlbConstants, "METS_TEAM_ID")],
  ["maximum stroke", numericConstant(coreTypes, "kMaxStrokeMm"), numericConstant(protocolCore, "MAX_STROKE_MM")],
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
