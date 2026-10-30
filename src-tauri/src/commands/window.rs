/// One window move for the whole morph frame: position and size land together.
#[tauri::command]
pub fn set_window_rect(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        // One update lands position and size together; two calls can tear the rect.
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                x,
                y,
                width as i32,
                height as i32,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
            .map_err(|e| e.to_string())
        }
    }
    #[cfg(not(windows))]
    {
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        window
            .set_size(tauri::PhysicalSize::new(width, height))
            .map_err(|e| e.to_string())
    }
}

// The high bit of GetAsyncKeyState reports whether the key is currently down.
#[cfg(target_os = "windows")]
#[link(name = "user32")]
unsafe extern "system" {
    fn GetAsyncKeyState(v_key: i32) -> i16;
}

/// True while the left mouse button is held. The desk widget waits for the
/// native drag to end before snapping; moving the window under the system move
/// loop gets undone at mouse-up.
#[tauri::command]
pub fn desk_left_button_down() -> bool {
    // VK_LBUTTON = 0x01.
    #[cfg(target_os = "windows")]
    let down = (unsafe { GetAsyncKeyState(0x01) } as u16 & 0x8000) != 0;
    #[cfg(not(target_os = "windows"))]
    let down = false;
    down
}
