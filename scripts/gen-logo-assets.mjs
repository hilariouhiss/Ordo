// Derives every logo asset from the one supplied file.
//
//     node scripts/gen-logo-assets.mjs
//
// `src/assets/logo.svg` is the artwork we were given: the mark with its
// background removed, so the ink is all that is left. Everything else follows
// from it, and nothing else is edited by hand:
//
//   src/assets/logo-dark.svg             the same mark, ink swapped for the dark
//                                        theme. Geometry untouched — the pixels
//                                        are re-coloured, never redrawn.
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
// for two fixed pictures. So this decodes and encodes PNGs itself, with node's
// own zlib. No dependencies.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = join(ROOT, "src", "assets", "logo.svg");
const DARK_SVG = join(ROOT, "src", "assets", "logo-dark.svg");
const RUNTIME = join(ROOT, "src-tauri", "icons", "runtime");
const CLI = join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");

/** Edge length `icons.rs` expects. */
const SIZE = 128;
/** The accent, which both variants keep: recolouring it would lose the brand. */
const ACCENT = [0x24, 0xc6, 0x8c];
/** The ink on a dark chrome — the light theme's paper, per `src/index.css`. */
const DARK_INK = [0xed, 0xe6, 0xe5];

const decode = (b64) => Buffer.from(b64, "base64");
const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decodes an 8-bit RGBA non-interlaced PNG (what the export and `tauri icon` write). */
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

/** Encodes 8-bit RGBA as a PNG with filter 0 on every row. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Reads the artwork out of the wrapper: the base64 payload, and the SVG around it. */
function readArtwork(svg) {
  const match = svg.match(/base64,([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error(`${SOURCE} carries no embedded bitmap`);
  const png = decodePng(decode(match[1]));
  // The background was removed, and the whole derivation rests on that: a plate
  // would make the dark variant a recoloured square and the icons unreadable on
  // one chrome or the other.
  if (png.rgba[3] !== 0) throw new Error("the artwork still has a background");
  return { png, svg, payload: match[1] };
}

/** The same drawing in `ink`, accent and alpha untouched. */
function reink(png, ink) {
  const out = Buffer.from(png.rgba);
  let changed = 0;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0 || same(out.subarray(i, i + 3), ACCENT)) continue;
    out[i] = ink[0];
    out[i + 1] = ink[1];
    out[i + 2] = ink[2];
    changed++;
  }
  if (!changed) throw new Error("nothing carried the ink colour");
  return out;
}

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

const source = readArtwork(readFileSync(SOURCE, "utf8"));
const dark = reink(source.png, DARK_INK);

// The dark copy is the source file with one payload swapped: the wrapper, the
// viewBox and the transform are the export's own and stay byte-identical.
writeFileSync(
  DARK_SVG,
  source.svg.replace(source.payload, encodePng(source.png.width, source.png.height, dark).toString("base64")),
);
console.log(`logo-dark.svg  from logo.svg (ink rgb(${DARK_INK}))`);

const light = raster(SOURCE);
const darkIcon = raster(DARK_SVG);
let reinked = 0;
for (let i = 0; i < light.length; i += 4) {
  // Same mark, different ink: the coverage must match pixel for pixel, or the
  // dark variant is a different drawing and the icons will disagree on shape.
  if (light[i + 3] !== darkIcon[i + 3]) throw new Error(`alpha differs at pixel ${i / 4}`);
  // The accent is deliberately the same colour in both, so only count the rest.
  if (light[i + 3] === 0 || same(light.subarray(i, i + 3), ACCENT)) continue;
  if (!same(light.subarray(i, i + 3), darkIcon.subarray(i, i + 3))) reinked++;
}
if (reinked === 0) throw new Error("both rasters carry the same ink");
if (light[3] !== 0) throw new Error("the light icon does not have a transparent corner");

for (const [name, rgba] of [
  ["light", light],
  ["dark", darkIcon],
]) {
  // `Image::new` trusts the caller for width and height, so a short buffer is a
  // buffer overrun rather than a wrong-looking icon; `cargo test --lib icons`
  // re-checks the length.
  writeFileSync(join(RUNTIME, `${name}.rgba`), rgba);
  console.log(`${name}.rgba    ${rgba.length} bytes`);
}
