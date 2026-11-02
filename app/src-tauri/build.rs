fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["core", "core_bytes"])),
    )
    .expect("failed to run tauri-build");
}
