/**
 * Release step: give the updater plain release URLs instead of API asset URLs.
 *
 * tauri-action writes latest.json with
 *   https://api.github.com/repos/{owner}/{repo}/releases/assets/{id}
 * as the download URL. Tauri's updater fetches that anonymously, and the GitHub
 * API answers anonymous asset downloads with 403 once its 60-requests-per-hour
 * bucket (shared by everyone behind the same IP) runs dry — the in-app download
 * then fails with "403 Forbidden" even though the check itself succeeded.
 *
 * The public download URL
 *   https://github.com/{owner}/{repo}/releases/download/{tag}/{name}
 * redirects to the same signed CDN URL without touching the API, so it has no
 * such bucket. This rewrites every platform entry and leaves the signatures (they
 * sign the binary, not the URL) untouched.
 *
 * Usage: node scripts/fix-updater-json.mjs <latest.json> <release.json> <tag>
 *   latest.json   the release's latest.json asset
 *   release.json  GET /repos/{owner}/{repo}/releases/tags/{tag} (assets carry names)
 */

import { readFileSync, writeFileSync } from "node:fs";

const [manifestPath, releasePath, tag] = process.argv.slice(2);
if (!manifestPath || !releasePath || !tag) {
  console.error("用法：node scripts/fix-updater-json.mjs <latest.json> <release.json> <tag>");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const release = JSON.parse(readFileSync(releasePath, "utf8"));
const names = new Map(release.assets.map((asset) => [asset.id, asset.name]));

const API_ASSET = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/releases\/assets\/(\d+)$/;
let changed = 0;

for (const platform of Object.values(manifest.platforms ?? {})) {
  const match = typeof platform.url === "string" ? API_ASSET.exec(platform.url) : null;
  if (!match) continue;
  const [, owner, repo, id] = match;
  const name = names.get(Number(id));
  if (!name) {
    console.warn(`asset ${id} 不在 release 的资产列表里，保留原 URL`);
    continue;
  }
  platform.url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${name}`;
  changed += 1;
}

if (changed === 0) {
  console.log("latest.json 里没有 API 资产 URL，保持原样");
  process.exit(0);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`改写 ${changed} 个下载 URL`);
