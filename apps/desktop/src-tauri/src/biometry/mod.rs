//! Unlock with Touch ID (Face ID on devices that have it). See mac.rs for how the key is kept.
//! On other systems these commands simply report that biometrics are not available.

#[cfg(target_os = "macos")]
mod mac;

/// "touchid", "faceid", "opticid" or "none".
#[tauri::command]
pub fn bio_kind() -> String {
    #[cfg(target_os = "macos")]
    return mac::kind().to_string();
    #[cfg(not(target_os = "macos"))]
    return "none".to_string();
}

/// Confirms the finger, then keeps the vault key in the keychain for later unlocks.
#[tauri::command]
pub async fn bio_enable(user: String, key: Vec<u8>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || mac::enable(&user, &key)).await.map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (user, key);
        Err("unavailable".into())
    }
}

/// Asks for the finger and hands back the vault key.
#[tauri::command]
pub async fn bio_unlock(user: String) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || mac::unlock(&user)).await.map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = user;
        Err("unavailable".into())
    }
}

/// Forgets the stored key.
#[tauri::command]
pub fn bio_disable(user: String) {
    #[cfg(target_os = "macos")]
    mac::disable(&user);
    #[cfg(not(target_os = "macos"))]
    let _ = user;
}
