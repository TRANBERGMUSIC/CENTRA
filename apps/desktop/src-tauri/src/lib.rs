use tauri::Manager;

mod mail;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch focuses the running window instead of opening another copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        // Auto-update from GitHub Releases (latest.json, minisign-verified) and relaunch after install.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Mail (IMAP/SMTP) and calendar feeds: the web layer can't open sockets, so Rust does it.
        .invoke_handler(tauri::generate_handler![mail::mail_test, mail::mail_fetch, mail::mail_update, mail::mail_send, mail::fetch_calendar])
        .run(tauri::generate_context!())
        .expect("error while running CENTRA");
}
