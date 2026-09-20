//! Theme-following app and tray icons.
//!
//! A window has exactly one icon, and Windows draws the taskbar and title bar
//! from it — so the two chromes cannot be given different artwork at the same
//! time. One icon cannot serve both either, now that the mark has no background:
//! its ink is black, which is 18.93:1 against the light Windows 11 taskbar
//! (`#f3f3f3`) and 1.29:1 against the dark one (`#202020`) — there, and
//! invisible. The measured alternative, one mid-tone that clears 3:1 on both, is
//! worse: it loses the green and is the dead end recorded in
//! `docs/DECISIONS.md` M16.
//!
//! So each theme gets the mark in the ink that reads on its own chrome:
//! `assets/logo.svg` as supplied (black ink, 18.93:1) and `assets/logo-dark.svg`
//! (the same pixels with the ink swapped for bone, 13.23:1). Neither is drawn by
//! hand — `node scripts/gen-logo-assets.mjs` derives the dark copy from the
//! supplied export and rasterises both into the files below; the procedure is in
//! `icons/runtime/README.md`.
//!
//! Both rasters are embedded and the right one is applied at startup from the
//! window theme, and again whenever [`apply`] is called — the frontend calls it
//! when the user changes the theme in settings.

use tauri::image::Image;
use tauri::{AppHandle, Manager, Runtime, Theme};

/// Edge length of both embedded rasters.
const SIZE: u32 = 128;
/// `SIZE * SIZE * 4` — `Image::new` trusts the caller for width and height, so a
/// mismatch would be a buffer overrun rather than a wrong-looking icon.
const RGBA_LEN: usize = (SIZE * SIZE * 4) as usize;

/// The icon for a light chrome: `assets/logo.svg`, black ink.
const LIGHT: &[u8] = include_bytes!("../icons/runtime/light.rgba");
/// The icon for a dark chrome: `assets/logo-dark.svg`, bone ink on the same shape.
const DARK: &[u8] = include_bytes!("../icons/runtime/dark.rgba");

/// Builds the icon for `theme`.
///
/// The bytes are raw RGBA rather than PNG on purpose: `Image::from_bytes` needs
/// tauri's `image-png` feature, which pulls in the whole `image` crate for two
/// fixed pictures. `Image::new` takes the decoded buffer directly, and the
/// conversion is a one-off done when the icons are generated.
fn raster(theme: Theme) -> Image<'static> {
    let rgba = match theme {
        Theme::Dark => DARK,
        // `Theme` is `Light | Dark`, but macOS reports neither until the window
        // exists, and an unknown theme still has to produce an icon.
        _ => LIGHT,
    };
    debug_assert_eq!(rgba.len(), RGBA_LEN, "embedded icon is not 128x128 RGBA");
    Image::new(rgba, SIZE, SIZE)
}

/// The theme to draw the frame for: the window's if it has one, else the OS's.
///
/// `WebviewWindow::theme()` falls back to the app-wide theme, which is the OS
/// setting unless something set it explicitly.
fn current<R: Runtime>(app: &AppHandle<R>) -> Theme {
    app.get_webview_window(crate::tray::MAIN_WINDOW)
        .and_then(|w| w.theme().ok())
        .unwrap_or(Theme::Light)
}

/// Applies `theme` to the main window, the quick-add window and the tray.
///
/// Every step is best-effort: there is nothing useful to tell the user about a
/// tray that would not repaint, and a failed repaint must not take the window
/// down with it.
pub fn apply<R: Runtime>(app: &AppHandle<R>, theme: Theme) {
    let icon = raster(theme);

    for label in [crate::tray::MAIN_WINDOW, crate::shortcut::QUICK_ADD_WINDOW] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.set_icon(icon.clone());
            // The frame colour is a separate setting from the artwork on
            // Windows, and the title bar follows it.
            let _ = window.set_theme(Some(theme));
        }
    }

    if let Some(tray) = app.tray_by_id(crate::tray::TRAY_ID) {
        let _ = tray.set_icon(Some(icon));
    }
}

/// Applies the window's current theme. Called once at startup, after the tray
/// exists — a tray built without an icon is invisible on Windows.
pub fn apply_current<R: Runtime>(app: &AppHandle<R>) {
    apply(app, current(app));
}

/// Switches the icons to `theme`, called from the frontend when the user picks
/// one. The frontend owns the preference; this only mirrors it onto the window
/// and the tray, neither of which the webview can reach on its own.
#[tauri::command(rename = "app:setTheme")]
pub fn set_theme<R: Runtime>(
    app: AppHandle<R>,
    theme: String,
) -> Result<(), crate::error::AppError> {
    apply(
        &app,
        if theme == "dark" {
            Theme::Dark
        } else {
            Theme::Light
        },
    );
    Ok(())
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
        for (name, rgba) in [("light", LIGHT), ("dark", DARK)] {
            assert_eq!(rgba[3], 0, "{name} icon has an opaque corner");
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
}
