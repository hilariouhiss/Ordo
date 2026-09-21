# Runtime icons

`light.rgba` / `dark.rgba` are 128x128 **raw RGBA** (65536 bytes each), embedded
by `src-tauri/src/icons.rs` with `include_bytes!` and handed to
`tauri::image::Image::new`.

They are raw rather than PNG because `Image::from_bytes` needs tauri's
`image-png` feature, which pulls in the whole `image` crate for two fixed
pictures. `Image::new` takes the decoded buffer directly.

Each file is the mark — a ring with the `#24C68C` dot in its gap, drawn as SVG
circles in `assets/logo.svg` — in the ink its own background can read:

| | source | ink | contrast on its background |
| --- | --- | --- | --- |
| `light.rgba` | `src/assets/logo.svg` | `#000000` | 18.93:1 on `#f3f3f3` |
| `dark.rgba` | `src/assets/logo-dark.svg` | `#EDE6E5` | 13.23:1 on `#202020` |

Which of the two a surface gets is decided by **who paints the background behind
it**, not by one app-wide setting:

| surface | follows | why |
| --- | --- | --- |
| title bar icon, window frame | the app theme | drawn where the page is |
| tray icon, taskbar icon | the system theme | they sit on the OS's own bars |

So choosing dark inside Ordo never turns the tray icon into a pale mark on a
light taskbar. The taskbar half needs `SendMessageW(WM_SETICON, ICON_BIG)` —
Tauri's `set_icon` only sends `ICON_SMALL`, the title bar — see
`docs/DECISIONS.md` M18 and `src-tauri/src/icons.rs`.

One file still cannot serve both chromes: with the background gone there is no
plate to carry the contrast, so black ink is 1.29:1 on the dark taskbar (there,
and invisible) and bone ink is 1.11:1 on the light one. The measured compromise
— a single mid-tone that clears 3:1 on both — loses the green entirely; that
dead end is `docs/DECISIONS.md` M16.

To regenerate after editing the mark:

1. `node scripts/gen-logo-assets.mjs` — copies `src/assets/logo.svg` to
   `logo-square.svg`, derives `src/assets/logo-dark.svg` from it (one drawing,
   the ring's ink swapped) and writes both `.rgba` files, checking that they
   cover the same pixels in different ink. Edit `logo.svg` only.
2. `pnpm tauri icon src/assets/logo.svg` — refreshes the packaged `.ico`/`.png`,
   which is what the bundle (Explorer, installer) wears and what a window has
   before `icons::apply_current` runs. One file, so it is the light variant; the
   mobile folders and the extra `64x64.png` it also writes are not part of this
   project. Delete them.
3. `cargo test --lib icons` — asserts both files are exactly 128*128*4 bytes,
   transparent at the corner, and one shape in two inks.
