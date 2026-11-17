/**
 * The release body is the CHANGELOG.md section for the pushed tag, so a GitHub
 * release says what changed instead of listing commits.
 *
 * Usage: node scripts/release-notes.mjs v0.2.2
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const tag = process.argv[2];
if (!tag) {
  console.error("用法：node scripts/release-notes.mjs <tag>（例如 v0.2.2）");
  process.exit(2);
}

// The tag names the version; CHANGELOG.md heads must carry it in brackets.
const version = tag.replace(/^v/, "");
const lines = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").split(/\r?\n/);
const heading = `## [${version}]`;
const start = lines.findIndex((line) => line.startsWith(heading));
if (start === -1) {
  console.error(`CHANGELOG.md 里没有「${heading}」这一节`);
  process.exit(1);
}

let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
if (end === -1) end = lines.length;
const notes = lines
  .slice(start + 1, end)
  .join("\n")
  .trim();
if (!notes) {
  console.error(`「${heading}」这一节是空的`);
  process.exit(1);
}
console.log(notes);
