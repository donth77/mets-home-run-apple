import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
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
  /(?:^|\/)(?:3D_PRINTING|BUILD_PLAN|HARDWARE_PLAN|IMPLEMENTATION_PLAN|PHYSICAL_BUILD|SIMULATOR_PLAN)\.md$/,
  /(?:^|\/)social-preview\.png$/,
];

const forbiddenContent = [
  ["private planning route", "localhost:3000/#sources"],
  ["private Sites deployment", "fynb0s.chatgpt.site"],
  ["auction item 178434719697", "178434719697"],
  ["auction item 137648047862", "137648047862"],
  ["internal source-notes heading", "SOURCE NOTES"],
];

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

  // This script necessarily contains the deny-list literals it searches for.
  if (path === "scripts/check-public-boundary.mjs") continue;
  if (!textExtensions.has(extname(path).toLowerCase())) continue;
  const content = await readFile(absolute, "utf8");
  for (const [label, marker] of forbiddenContent) {
    if (content.includes(marker)) violations.push(`${path}: contains ${label}`);
  }
}

if (violations.length > 0) {
  console.error(`Public-boundary check failed:\n${violations.map((line) => `- ${line}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Public-boundary check passed.");
}
