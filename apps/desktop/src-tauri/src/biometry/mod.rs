//! Unlock with Touch ID on the Mac and Face ID on the iPhone. See mac.rs for how the key is kept
//! (the same LocalAuthentication and keychain calls work on both).
//! On other systems these commands simply report that biometrics are not available.

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod mac;

/// "touchid", "faceid", "opticid" or "none".
#[tauri::command]
pub fn bio_kind() -> String {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return mac::kind().to_string();
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    return "none".to_string();
}

/// Confirms the finger, then keeps the vault key in the keychain for later unlocks.
#[tauri::command]
pub async fn bio_enable(user: String, key: Vec<u8>) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return tauri::async_runtime::spawn_blocking(move || mac::enable(&user, &key)).await.map_err(|e| e.to_string())?;
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (user, key);
        Err("unavailable".into())
    }
}

/// Asks for the finger and hands back the vault key.
#[tauri::command]
pub async fn bio_unlock(user: String) -> Result<Vec<u8>, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return tauri::async_runtime::spawn_blocking(move || mac::unlock(&user)).await.map_err(|e| e.to_string())?;
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = user;
        Err("unavailable".into())
    }
}

/// Forgets the stored key.
#[tauri::command]
pub fn bio_disable(user: String) {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    mac::disable(&user);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let _ = user;
}
