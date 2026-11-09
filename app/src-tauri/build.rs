fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "core",
                "core_bytes",
                "shell_close_ready",
                "shell_finish_close",
            ])),
    )
    .expect("failed to run tauri-build");
}
