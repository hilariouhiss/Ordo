/**
 * Release gate: the pushed tag and the three version fields must agree.
 *
 * The app version lives in three files that cannot see each other —
 * `src-tauri/Cargo.toml` (the binary), `src-tauri/tauri.conf.json` (the bundle
 * and the updater's `latest.json`) and `package.json` (the JS side). The
 * release workflow is triggered by a tag, and `tauri-action` writes the app
 * version into `latest.json`: a tag that disagrees with those files publishes a
 * release that updates nobody, while looking perfectly successful. So the
 * workflow runs this first and fails loudly instead.
 *
 * Usage: node scripts/check-release-version.mjs v0.1.5
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** The `[package]` section's version — `[dependencies]` has `version` keys too. */
function cargoVersion(text) {
  const section = text.match(/^\[package\][\s\S]*?(?=^\[|\Z)/m);
  if (!section) throw new Error("src-tauri/Cargo.toml 里找不到 [package] 段");
  const version = section[0].match(/^version\s*=\s*"([^"]+)"/m);
  if (!version) throw new Error("src-tauri/Cargo.toml 的 [package] 里没有 version");
  return version[1];
}

function jsonVersion(path) {
  return JSON.parse(readFileSync(path, "utf8")).version;
}

const tag = process.argv[2];
if (!tag) {
  console.error("用法：node scripts/check-release-version.mjs <tag>（例如 v0.1.5）");
  process.exit(2);
}

const expected = tag.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(expected)) {
  console.error(`tag「${tag}」不是 vX.Y.Z 形式——发布版本必须能直接比较 semver。`);
  process.exit(1);
}

const found = [
  ["src-tauri/Cargo.toml", cargoVersion(readFileSync(join(ROOT, "src-tauri/Cargo.toml"), "utf8"))],
  ["src-tauri/tauri.conf.json", jsonVersion(join(ROOT, "src-tauri/tauri.conf.json"))],
  ["package.json", jsonVersion(join(ROOT, "package.json"))],
];

const mismatched = found.filter(([, version]) => version !== expected);
if (mismatched.length > 0) {
  console.error(`tag ${tag} 与三处版本号不一致（期望 ${expected}）：`);
  for (const [file, version] of mismatched) console.error(`  ${file}: ${version}`);
  console.error("先提交一次版本号 bump，再打 tag——否则发布的 latest.json 会带着旧版本号，谁都不会更新。");
  process.exit(1);
}

console.log(`版本一致：${found.map(([file, version]) => `${file}=${version}`).join("、")}`);
