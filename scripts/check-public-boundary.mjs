import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keeps private material out of the public tree.
//
// Path rules live here. Content markers do not: a public deny list would
// publish the very strings it guards. Markers come from the
// PUBLIC_BOUNDARY_MARKERS environment variable (CI passes the repository
// secret of that name) and from scripts/public-boundary.local, which is
// gitignored. One marker per line; `#` starts a comment. A match is reported
// by number only, so the strings never reach a public log either.

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localMarkersPath = "scripts/public-boundary.local";
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage", ".pio", ".wrangler"]);
const textExtensions = new Set([
  "",
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const forbiddenPaths = [
  /^\.openai(?:\/|$)/,
  /(?:^|\/)internal-assets(?:\/|$)/,
  /(?:^|\/)private-planning(?:\/|$)/,
  /(?:^|\/)specs(?:\/|$)/,
  /(?:^|\/)(?:3D_PRINTING|BUILD_PLAN|HARDWARE_PLAN|IMPLEMENTATION_PLAN|PHYSICAL_BUILD|SIMULATOR_PLAN)\.md$/,
  /(?:^|\/)social-preview\.png$/,
];

function parseMarkers(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

const markers = new Set(parseMarkers(process.env.PUBLIC_BOUNDARY_MARKERS ?? ""));
if (existsSync(resolve(root, localMarkersPath))) {
  for (const marker of parseMarkers(await readFile(resolve(root, localMarkersPath), "utf8"))) markers.add(marker);
}
const markerList = [...markers];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const violations = [];
for (const absolute of await walk(root)) {
  const path = relative(root, absolute).replaceAll("\\", "/");
  for (const pattern of forbiddenPaths) {
    if (pattern.test(path)) violations.push(`${path}: forbidden public path (${pattern})`);
  }

  if (path === localMarkersPath) continue;
  if (!textExtensions.has(extname(path).toLowerCase())) continue;
  const content = await readFile(absolute, "utf8");
  markerList.forEach((marker, index) => {
    if (content.includes(marker))
      violations.push(`${path}: contains private marker ${index + 1} of ${markerList.length}`);
  });
}

if (violations.length > 0) {
  console.error(`Public-boundary check failed:\n${violations.map((line) => `- ${line}`).join("\n")}`);
  process.exitCode = 1;
} else if (markerList.length === 0) {
  console.warn(
    `Public-boundary check passed on path rules only: no private markers configured (set PUBLIC_BOUNDARY_MARKERS or create ${localMarkersPath}).`,
  );
} else {
  console.log(`Public-boundary check passed (${markerList.length} private markers).`);
}
