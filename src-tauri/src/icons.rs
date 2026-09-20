//! Theme-following app, taskbar and tray icons.
//!
//! Two themes decide these, and they are not the same one:
//!
//! - the **app** theme paints the frame and the title bar, so the icon inside
//!   that frame carries the ink that reads on it;
//! - the **system** theme paints the background the tray and the taskbar sit
//!   on, so those two carry the ink that reads on *that* — the app being dark
//!   while Windows is light must not put a bone-white mark in the taskbar.
//!
//! The system half is read from the **quick-add window**, and that is not
//! arbitrary. `Window::set_theme` makes tauri re-pin the webview's WebView2
//! `PreferredColorScheme` to whatever theme it was given (wry's `set_theme`), so
//! a page's `prefers-color-scheme` reports what this app last wrote rather than
//! what the OS is doing — and tao skips *pinned* windows when the OS theme
//! changes, so a pinned window never reports the system setting again. The
//! quick-add window is the one window this module never pins: it is frameless,
//! so it has no chrome to theme, and being unpinned it keeps reporting the OS
//! theme and keeps announcing changes to it. Do not pin it.
//!
//! Reading the OS theme out of the page instead is what made the tray and the
//! taskbar follow the *app* theme — the app's own output fed back in as input —
//! and, because every write also fires a `prefers-color-scheme` change event in
//! every page, a listener on that event wrote the theme again: a loop, visible
//! as the whole window flickering. `docs/DECISIONS.md` M18 has the trace.
//!
//! One icon cannot serve both chromes either way: with the mark's background
//! removed there is no plate left to carry the contrast, and black ink is
//! 18.93:1 against the light Windows 11 taskbar (`#f3f3f3`) but 1.29:1 against
//! the dark one (`#202020`) — there, and invisible. The measured compromise, one
//! mid-tone that clears 3:1 on both, loses the green; that is the dead end
//! recorded in `docs/DECISIONS.md` M16.
//!
//! So both inks are embedded — `assets/logo.svg` as supplied and
//! `assets/logo-dark.svg`, the same pixels re-inked — and each target picks the
//! one belonging to its theme. `node scripts/gen-logo-assets.mjs` derives the
//! dark copy and rasterises both into the files below; `icons/runtime/README.md`
//! has the procedure.
//!
//! On Windows the split has a wrinkle Tauri does not cover: `set_icon` reaches
//! `ICON_SMALL`, which is the title bar, while the taskbar and Alt+Tab draw from
//! `ICON_BIG` — a slot nothing had written since the window was created with the
//! bundled `.ico`. [`set_taskbar_icon`] is that missing half.

use std::sync::atomic::{AtomicU8, Ordering};

use tauri::image::Image;
use tauri::{AppHandle, Emitter, Manager, Runtime, Theme};

/// Event carrying the OS theme to the frontend: `"dark"` or `"light"`.
///
/// The preference lives in the webview (localStorage), but the value it resolves
/// *to* when it is "system" cannot be read there — that is the point of this
/// module — so Rust reads it and pushes it.
pub const SYSTEM_THEME_EVENT: &str = "app:systemThemeChanged";

/// Edge length of both embedded rasters.
const SIZE: u32 = 128;
/// `SIZE * SIZE * 4` — `Image::new` trusts the caller for width and height, so a
/// mismatch would be a buffer overrun rather than a wrong-looking icon.
const RGBA_LEN: usize = (SIZE * SIZE * 4) as usize;

/// The ink for a light background: `assets/logo.svg`, black.
const LIGHT: &[u8] = include_bytes!("../icons/runtime/light.rgba");
/// The ink for a dark background: `assets/logo-dark.svg`, bone, same pixels.
const DARK: &[u8] = include_bytes!("../icons/runtime/dark.rgba");

/// The OS theme last handed to the tray and the taskbar: 0 not read yet, 1
/// light, 2 dark.
///
/// Only there to drop the events this module causes itself: `set_theme` raises
/// `ThemeChanged` too (tao's `update_theme` runs for both causes), so without
/// this every app-theme change would hand the tray the same artwork again.
static APPLIED: AtomicU8 = AtomicU8::new(0);

/// The raster for `theme`.
///
/// Raw RGBA rather than PNG on purpose: `Image::from_bytes` needs tauri's
/// `image-png` feature, which pulls in the whole `image` crate for two fixed
/// pictures. `Image::new` takes the decoded buffer directly, and the conversion
/// is a one-off done when the icons are generated.
fn bytes(theme: Theme) -> &'static [u8] {
    match theme {
        Theme::Dark => DARK,
        // `Theme` is `Light | Dark`, but macOS reports neither until the window
        // exists, and an unknown theme still has to produce an icon.
        _ => LIGHT,
    }
}

/// `bytes` as a tauri image.
fn raster(theme: Theme) -> Image<'static> {
    let rgba = bytes(theme);
    debug_assert_eq!(rgba.len(), RGBA_LEN, "embedded icon is not 128x128 RGBA");
    Image::new(rgba, SIZE, SIZE)
}

/// The theme a name from the frontend refers to.
fn parse(name: &str) -> Theme {
    if name == "dark" {
        Theme::Dark
    } else {
        Theme::Light
    }
}

/// The name the frontend uses for `theme`.
fn name(theme: Theme) -> &'static str {
    if theme == Theme::Dark {
        "dark"
    } else {
        "light"
    }
}

/// The code [`APPLIED`] stores for `theme`.
fn code(theme: Theme) -> u8 {
    if theme == Theme::Dark {
        2
    } else {
        1
    }
}

/// The OS theme, or `None` while no window can report it.
///
/// Read from the quick-add window, which this module never pins — see the module
/// docs. The main window is pinned to the app theme on purpose, so it can only
/// answer with what the app decided.
fn system<R: Runtime>(app: &AppHandle<R>) -> Option<Theme> {
    app.get_webview_window(crate::shortcut::QUICK_ADD_WINDOW)
        .or_else(|| app.get_webview_window(crate::tray::MAIN_WINDOW))
        .and_then(|window| window.theme().ok())
}

/// Applies the app theme: the frame of the main window, and the icon in it.
///
/// Every step is best-effort: there is nothing useful to tell the user about a
/// frame that would not repaint, and a failed repaint must not take the window
/// down with it.
pub fn apply_app<R: Runtime>(app: &AppHandle<R>, theme: Theme) {
    if let Some(window) = app.get_webview_window(crate::tray::MAIN_WINDOW) {
        // Windows: `ICON_SMALL`, the icon in the title bar. Elsewhere this is
        // the window's one icon, which is also what the taskbar reads.
        let _ = window.set_icon(raster(theme));
        // The frame colour is a separate setting from the artwork, and on
        // Windows this is what decides whether the title bar is dark.
        let _ = window.set_theme(Some(theme));
    }
}

/// Applies the system theme: the tray icon, and the taskbar icon on Windows.
///
/// Both surfaces sit on chrome the OS paints, which is why they follow the OS
/// theme rather than the app's: choosing dark inside Ordo must not turn the tray
/// icon into a pale mark on a light taskbar.
pub fn apply_system<R: Runtime>(app: &AppHandle<R>, theme: Theme) {
    if let Some(tray) = app.tray_by_id(crate::tray::TRAY_ID) {
        let _ = tray.set_icon(Some(raster(theme)));
    }

    #[cfg(windows)]
    set_taskbar_icon(app, bytes(theme));
}

/// Re-reads the OS theme, and when it moved, repaints the tray and the taskbar
/// and tells the frontend.
///
/// Called at startup and on every `ThemeChanged`. The event's payload is
/// deliberately ignored: this module's own `set_theme` calls raise that event
/// too, so what arrives may be the app theme rather than the system one. The
/// probe window is the only reading that means "the OS", and [`APPLIED`] keeps a
/// self-caused event from repainting anything.
pub fn refresh_system<R: Runtime>(app: &AppHandle<R>) {
    let Some(theme) = system(app) else {
        return;
    };
    if APPLIED.swap(code(theme), Ordering::Relaxed) == code(theme) {
        return;
    }

    apply_system(app, theme);
    // The frontend cannot read the OS theme itself (module docs), so its
    // "system" preference resolves against this.
    let _ = app.emit(SYSTEM_THEME_EVENT, name(theme));
}

/// Applies the theme the chrome is currently drawn in, for startup.
///
/// Called once at startup, after the tray exists — a tray built without an icon
/// is invisible on Windows. Both halves start on the OS theme: the frontend has
/// not loaded yet, so the app theme is not known, and using the OS theme for the
/// frame as well keeps the title bar icon in step with the frame it sits in
/// until the frontend says otherwise.
pub fn apply_current<R: Runtime>(app: &AppHandle<R>) {
    let Some(theme) = system(app) else {
        return;
    };
    APPLIED.store(code(theme), Ordering::Relaxed);
    apply_app(app, theme);
    apply_system(app, theme);
}

/// Switches the app's chrome — the frame and the icon in it — to `theme`.
///
/// The frontend owns that preference. The tray and the taskbar are not its to
/// choose: they follow the OS theme, through [`refresh_system`].
#[tauri::command(rename = "app:setTheme")]
pub fn set_theme<R: Runtime>(
    app: AppHandle<R>,
    theme: String,
) -> Result<(), crate::error::AppError> {
    apply_app(&app, parse(&theme));
    Ok(())
}

/// The OS theme, for the frontend's "system" preference.
///
/// `None` is "not known yet" rather than a default, so the caller keeps what it
/// already had instead of guessing.
#[tauri::command(rename = "app:systemTheme")]
pub fn system_theme<R: Runtime>(app: AppHandle<R>) -> Option<&'static str> {
    system(&app).map(name)
}

/// Fills the `ICON_BIG` slot: what the taskbar button and Alt+Tab draw.
///
/// Tauri cannot reach it. `WebviewWindow::set_icon` ends up in tao's
/// `set_window_icon`, which sends `ICON_SMALL` — the title bar — so the taskbar
/// kept the bundled `.ico` it was created with, whatever the theme. That is the
/// icon a dark taskbar renders a black mark on.
#[cfg(windows)]
fn set_taskbar_icon<R: Runtime>(app: &AppHandle<R>, rgba: &'static [u8]) {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, ICON_BIG, WM_SETICON};

    // The quick-add window skips the taskbar, so the main window is the only one
    // with a button to paint.
    let Some(window) = app.get_webview_window(crate::tray::MAIN_WINDOW) else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let Some(icon) = hicon(rgba) else {
        return;
    };

    unsafe {
        SendMessageW(
            hwnd,
            WM_SETICON,
            Some(WPARAM(ICON_BIG as usize)),
            Some(LPARAM(icon.0 as isize)),
        );
    }
}

/// Builds the `HICON` for `rgba`, the way tao builds its own (tao's
/// `platform_impl/windows/icon.rs`): a 32-bit icon is BGRA, and the 1-bit mask
/// that predates the alpha channel is its inverse. Windows copies what it needs
/// out of both buffers.
///
/// The handle is deliberately left undestroyed — the taskbar may still be
/// holding it, and Windows frees it with the process; one per theme change is
/// 64 KB.
#[cfg(windows)]
fn hicon(rgba: &[u8]) -> Option<windows::Win32::UI::WindowsAndMessaging::HICON> {
    use windows::Win32::UI::WindowsAndMessaging::CreateIcon;

    let mut pixels = rgba.to_vec();
    let (pixels, _) = pixels.as_chunks_mut::<4>();
    let mut mask = Vec::with_capacity(pixels.len());
    for pixel in pixels.iter_mut() {
        mask.push(pixel[3].wrapping_sub(u8::MAX));
        pixel.swap(0, 2);
    }

    unsafe {
        CreateIcon(
            None,
            SIZE as i32,
            SIZE as i32,
            1,
            32,
            mask.as_ptr(),
            pixels.as_ptr() as *const u8,
        )
    }
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Both embedded rasters must be exactly one image. `include_bytes!` is
    /// checked by the compiler for existence but not for length, and a wrong
    /// length reaches `Image::new` as a straight buffer overrun.
    #[test]
    fn both_rasters_are_one_image() {
        assert_eq!(LIGHT.len(), RGBA_LEN, "light icon is not 128x128 RGBA");
        assert_eq!(DARK.len(), RGBA_LEN, "dark icon is not 128x128 RGBA");
    }

    /// The mark has no background, so the corner must be clear in both: a plate
    /// there would be a white or near-black square on the taskbar, which is what
    /// the earlier icon had to work around.
    #[test]
    fn both_are_transparent_at_the_corner() {
        for (label, rgba) in [("light", LIGHT), ("dark", DARK)] {
            assert_eq!(rgba[3], 0, "{label} icon has an opaque corner");
        }
    }

    /// The two must be one drawing in two inks: identical coverage, and a
    /// different colour wherever the ink shows. Shipping one file twice passes
    /// every other check here, and so does a dark copy that was redrawn rather
    /// than re-inked — both would leave one chrome with an unreadable icon.
    #[test]
    fn the_two_are_one_shape_in_different_ink() {
        let (light_px, _) = LIGHT.as_chunks::<4>();
        let (dark_px, _) = DARK.as_chunks::<4>();
        let mut differing = 0;
        for (light, dark) in light_px.iter().zip(dark_px) {
            assert_eq!(light[3], dark[3], "the two icons cover different pixels");
            if light[..3] != dark[..3] {
                differing += 1;
            }
        }
        assert!(differing > 0, "both icons carry the same ink");
    }

    /// The frontend sends names, not `Theme`s, and a typo would silently mean
    /// "light". The same string travels back on the event, so the round trip has
    /// to be its own inverse.
    #[test]
    fn names_map_to_themes() {
        assert_eq!(parse("dark"), Theme::Dark);
        assert_eq!(parse("light"), Theme::Light);
        assert_eq!(name(parse("dark")), "dark");
        assert_eq!(name(parse("light")), "light");
    }

    /// Windows only takes the two buffers raw, so a wrong length or channel
    /// order comes back as a refused handle here rather than as a blank icon in
    /// the taskbar, which nothing else would notice.
    #[cfg(windows)]
    #[test]
    fn the_taskbar_icon_builds_a_handle() {
        for (label, rgba) in [("light", LIGHT), ("dark", DARK)] {
            assert!(
                hicon(rgba).is_some(),
                "{label}: CreateIcon refused the buffers"
            );
        }
    }
}
