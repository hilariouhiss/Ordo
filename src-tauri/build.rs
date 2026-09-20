fn main() {
    // `tauri_build::build()` emits `rerun-if-changed` for `tauri.conf.json` and
    // `capabilities/` only — NOT for `icons/`. The icons are embedded into the
    // executable as a Windows resource at compile time, so regenerating them
    // (`tauri icon …`) leaves the running binary showing the previous artwork
    // until something else happens to invalidate the build. That is a genuinely
    // confusing failure: the files on disk are right, the title bar and taskbar
    // are not.
    //
    // Watching the directory fixes it at the source. Cargo also re-runs this
    // script when the script itself changes, so the first build after adding
    // this line is a full rebuild.
    println!("cargo:rerun-if-changed=icons");

    tauri_build::build()
}
