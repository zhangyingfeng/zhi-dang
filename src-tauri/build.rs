fn main() {
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
    tauri_build::AppManifest::new().commands(&[
      "open_login_window",
      "close_login_window",
      "zhihu_fetch",
      "zhihu_fetch_result",
      "zhihu_me",
      "wait_for_login",
    ]),
  ))
  .expect("failed to run tauri-build");
}
