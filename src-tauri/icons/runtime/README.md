# Runtime icons

`light.rgba` / `dark.rgba` are 128x128 **raw RGBA** (65536 bytes each), embedded
by `src-tauri/src/icons.rs` with `include_bytes!` and handed to
`tauri::image::Image::new`.

They are raw rather than PNG because `Image::from_bytes` needs tauri's
`image-png` feature, which pulls in the whole `image` crate for two fixed
pictures. `Image::new` takes the decoded buffer directly.

Each file is the supplied mark — the artwork with its background removed, black
ring and `#24C68C` dot — in the ink its own chrome can read:

| | source | ink | on its taskbar |
| --- | --- | --- | --- |
| `light.rgba` | `src/assets/logo.svg` | `#000000` | 18.93:1 on `#f3f3f3` |
| `dark.rgba` | `src/assets/logo-dark.svg` | `#EDE6E5` | 13.23:1 on `#202020` |

One file cannot serve both: with the background gone there is no plate to carry
the contrast, so black ink is 1.29:1 on the dark taskbar (there, and invisible)
and bone ink is 1.11:1 on the light one. The measured compromise — a single
mid-tone that clears 3:1 on both — loses the green entirely; that dead end is
`docs/DECISIONS.md` M16. Two files, one per chrome, chosen at runtime: a window
has a single icon, and Windows draws the taskbar, the title bar and Alt+Tab from
it.

To regenerate after replacing the supplied artwork:

1. `node scripts/gen-logo-assets.mjs` — derives `src/assets/logo-dark.svg` from
   `src/assets/logo.svg` (same pixels, ink swapped; it refuses a file that still
   has a background) and writes both `.rgba` files, checking that they cover the
   same pixels in different ink.
2. `pnpm tauri icon src/assets/logo.svg` — refreshes the packaged `.ico`/`.png`,
   which is what the bundle (Explorer, installer) wears and what a window has
   before `icons::apply_current` runs. One file, so it is the light variant; the
   mobile folders it also writes are not part of this project. Delete them.
3. `cargo test --lib icons` — asserts both files are exactly 128*128*4 bytes,
   transparent at the corner, and one shape in two inks.
