// Derives every logo asset from the one vector file.
//
//     node scripts/gen-logo-assets.mjs
//
// `src/assets/logo.svg` is the mark itself — a ring with a circular bite out of
// its top right and the accent dot sitting in the bite, drawn as SVG circles
// rather than traced from a bitmap, so every size below is rendered from the
// same geometry. Everything else follows from it, and nothing else is edited by
// hand:
//
//   src/assets/logo-square.svg           a byte-identical copy, for square uses.
//   src/assets/logo-dark.svg             the same drawing with the ink swapped
//                                        for the dark theme: one string changes,
//                                        no coordinate moves.
//   src-tauri/icons/runtime/light.rgba   128x128 raw RGBA, embedded by
//   src-tauri/icons/runtime/dark.rgba    `src-tauri/src/icons.rs` and set on the
//                                        window and the tray per theme.
//
// The packaged set (`src-tauri/icons/*.ico|png`) is the next step, one command
// and one file because a bundle can only carry one: `pnpm tauri icon
// src/assets/logo.svg` (then delete the mobile folders it also writes).
//
// Raw RGBA rather than PNG for the runtime pair because `Image::new` takes a
// decoded buffer; `Image::from_bytes` would pull tauri's whole `image` crate in
// for two fixed pictures. So this decodes the PNGs `tauri icon` writes itself,
// with node's own zlib. No dependencies.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = join(ROOT, "src", "assets", "logo.svg");
const SQUARE = join(ROOT, "src", "assets", "logo-square.svg");
const DARK_SVG = join(ROOT, "src", "assets", "logo-dark.svg");
const RUNTIME = join(ROOT, "src-tauri", "icons", "runtime");
const CLI = join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");

/** Edge length `icons.rs` expects. */
const SIZE = 128;
// The ring's ink in `logo.svg`, exactly as the file spells it. Both variants
// are the same drawing, so swapping this one string is the whole difference.
const LIGHT_INK = 'fill="#000000"';
/** The same ink on a dark chrome — the light theme's paper, per `src/index.css`. */
const DARK_INK = 'fill="#EDE6E5"';
/** The accent, which both variants keep: recolouring it would lose the brand. */
const ACCENT = [0x24, 0xc6, 0x8c];

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decodes an 8-bit RGBA non-interlaced PNG (what `tauri icon` writes). */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width, height, depth, colour, ended = false;
  const parts = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG is not supported");
    } else if (type === "IDAT") parts.push(data);
    else if (type === "IEND") ended = true;
    pos += 12 + len;
  }
  if (!width || !ended) throw new Error("truncated PNG");
  if (depth !== 8 || colour !== 6) {
    throw new Error(`expected 8-bit RGBA, got depth ${depth} colour type ${colour}`);
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const rgba = Buffer.alloc(height * stride);
  const zero = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error(`unknown filter ${filter} on row ${y}`);
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y ? rgba.subarray((y - 1) * stride, y * stride) : zero;
    const cur = rgba.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? cur[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      const v = line[x];
      cur[x] =
        filter === 0
          ? v
          : filter === 1
            ? (v + a) & 255
            : filter === 2
              ? (v + b) & 255
              : filter === 3
                ? (v + ((a + b) >> 1)) & 255
                : (v + paeth(a, b, c)) & 255;
    }
  }
  return { width, height, rgba };
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Rasterises `svg` at `SIZE` px and returns its pixels. */
function raster(svg) {
  const dir = mkdtempSync(join(tmpdir(), "ordo-icon-"));
  const run = spawnSync(process.execPath, [CLI, "icon", svg, "-o", dir, "-p", String(SIZE)], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (run.status !== 0) throw new Error(`tauri icon failed for ${svg}`);
  const png = decodePng(readFileSync(join(dir, `${SIZE}x${SIZE}.png`)));
  if (png.width !== SIZE || png.height !== SIZE) {
    throw new Error(`${svg} rasterised to ${png.width}x${png.height}, expected ${SIZE}`);
  }
  return png.rgba;
}

const source = readFileSync(SOURCE, "utf8");
const inks = source.split(LIGHT_INK).length - 1;
if (inks !== 1) {
  throw new Error(`${SOURCE} carries the light ink ${inks} times, expected exactly one`);
}
if (source.includes("base64,")) {
  throw new Error(`${SOURCE} still embeds a bitmap: it is meant to be the drawing itself`);
}

// The dark copy is the source with one string swapped, so the two cover the same
// pixels by construction rather than by a redraw that "matches on paper".
writeFileSync(DARK_SVG, source.replace(LIGHT_INK, DARK_INK));
console.log(`logo-dark.svg  from logo.svg (ring ink ${DARK_INK.match(/"([^"]+)"/)[1]})`);

// The square copy is the same bytes: one drawing, two names, no third version.
copyFileSync(SOURCE, SQUARE);
console.log("logo-square.svg copied from logo.svg");

const light = raster(SOURCE);
const dark = raster(DARK_SVG);
let reinked = 0;
for (let i = 0; i < light.length; i += 4) {
  // Same mark, different ink: the coverage must match pixel for pixel, or the
  // dark variant is a different drawing and the icons will disagree on shape.
  if (light[i + 3] !== dark[i + 3]) throw new Error(`alpha differs at pixel ${i / 4}`);
  // The accent is deliberately the same colour in both, so only count the rest.
  if (light[i + 3] === 0 || same(light.subarray(i, i + 3), ACCENT)) continue;
  if (!same(light.subarray(i, i + 3), dark.subarray(i, i + 3))) reinked++;
}
if (reinked === 0) throw new Error("both rasters carry the same ink");
if (light[3] !== 0) throw new Error("the light icon does not have a transparent corner");

for (const [name, rgba] of [
  ["light", light],
  ["dark", dark],
]) {
  // `Image::new` trusts the caller for width and height, so a short buffer is a
  // buffer overrun rather than a wrong-looking icon; `cargo test --lib icons`
  // re-checks the length.
  writeFileSync(join(RUNTIME, `${name}.rgba`), rgba);
  console.log(`${name}.rgba    ${rgba.length} bytes`);
}
