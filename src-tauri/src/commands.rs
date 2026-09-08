//! Tauri command handlers (the IPC boundary between SolidJS and Rust).
//!
//! Each `#[tauri::command]` is a thin wrapper that delegates to the services
//! layer. Register new commands in `lib.rs`'s `invoke_handler`.

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}
