import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "packages/apple-3d/assets/asset-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

for (const asset of manifest.assets) {
  const assetPath = path.join(root, "packages/apple-3d/assets", asset.path);
  const bytes = await readFile(assetPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.sha256) {
    throw new Error(`${asset.id}: expected ${asset.sha256}, received ${digest}`);
  }
}

const requiredModels = ["citi-apple-model", "citi-base-model"];
for (const id of requiredModels) {
  if (!manifest.assets.some((asset) => asset.id === id)) {
    throw new Error(`Missing required 3D asset manifest entry: ${id}`);
  }
}

console.log(`Verified ${manifest.assets.length} manifested 3D/decal assets.`);
