//! Import from the Mac's Contacts app. On other systems the command reports "unavailable"
//! (a vCard file can still be imported from the interface).

#[cfg(target_os = "macos")]
mod mac;

/// Every contact on this Mac, as plain data. macOS asks for permission the first time.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn contacts_fetch() -> Result<Vec<mac::MacContact>, String> {
    tauri::async_runtime::spawn_blocking(mac::fetch).await.map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn contacts_fetch() -> Result<Vec<()>, String> {
    Err("unavailable".into())
}

/// Asks nothing: just says whether macOS has already given (or refused) access to Contacts.
#[tauri::command]
pub fn contacts_status() -> String {
    #[cfg(target_os = "macos")]
    return mac::status().to_string();
    #[cfg(not(target_os = "macos"))]
    return "unavailable".to_string();
}
