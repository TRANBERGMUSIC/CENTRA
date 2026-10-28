use tauri::Manager;

mod biometry;
mod contacts;
mod lunchhub;
mod mail;
mod webupdate;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Interface files come from the newest installed fast update, falling back to the built-in ones.
    let mut context = tauri::generate_context!();
    let builtin = context.set_assets(Box::new(webupdate::NoAssets));
    context.set_assets(Box::new(webupdate::LiveAssets::new(builtin)));

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
        // Links (opsig, guides, mailto:, tel:, sms:) open in the browser / Mail / Messages.
        .plugin(tauri_plugin_opener::init())
        // Mail (IMAP/SMTP) and calendar feeds: the web layer can't open sockets, so Rust does it.
        .invoke_handler(tauri::generate_handler![
            mail::mail_test, mail::mail_fetch, mail::mail_update, mail::mail_send, mail::fetch_calendar, mail::mail_body, mail::mail_part, mail::mail_save_part,
            webupdate::web_ready, webupdate::web_info, webupdate::web_update_check, webupdate::session_stash, webupdate::session_take,
            biometry::bio_kind, biometry::bio_enable, biometry::bio_unlock, biometry::bio_disable,
            contacts::contacts_fetch, contacts::contacts_status,
            lunchhub::lunchhub_request
        ])
        // Choose the interface (installed fast update or the built-in one) before the window opens.
        .setup(|app| {
            webupdate::init(app);
            if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() {
                tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?.build()?;
            }
            Ok(())
        })
        .run(context)
        .expect("error while running CENTRA");
}
