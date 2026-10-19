#[tauri::command]
fn greet(name: &str) -> String {
  format!("Hello, {name}! From Rust.")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![greet])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
  use super::greet;

  #[test]
  fn greet_formats_name() {
    assert_eq!(greet("Ordo"), "Hello, Ordo! From Rust.");
  }
}
