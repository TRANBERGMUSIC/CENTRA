//! The iPhone app's own Swift (scripts/ios/CentraPush.swift, CentraAlarms.swift, CentraFiles.swift), called by name
//! through the Objective-C runtime. When a build went out without them (see ios-testflight.sh), the
//! class isn't there and the command says "unavailable". On the Mac these are no-ops.

#[cfg(target_os = "ios")]
mod ios {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::AnyClass;
    use objc2_foundation::NSString;

    pub fn class(name: &std::ffi::CStr) -> Option<&'static AnyClass> {
        AnyClass::get(name)
    }
    pub fn call0(name: &std::ffi::CStr, sel: &str) -> Option<String> {
        let cls = class(name)?;
        let out: Retained<NSString> = unsafe {
            match sel {
                "token" => msg_send![cls, token],
                "problem" => msg_send![cls, problem],
                "status" => msg_send![cls, status],
                _ => return None,
            }
        };
        Some(out.to_string())
    }
    pub fn register() -> bool {
        match class(c"CentraPush") {
            Some(cls) => {
                let _: () = unsafe { msg_send![cls, register] };
                true
            }
            None => false,
        }
    }
    pub fn file(path: &str, share: bool) -> bool {
        match class(c"CentraFiles") {
            Some(cls) => {
                let arg = NSString::from_str(path);
                let _: () = unsafe { if share { msg_send![cls, share: &*arg] } else { msg_send![cls, preview: &*arg] } };
                true
            }
            None => false,
        }
    }
    pub fn alarms(json: &str) -> String {
        match class(c"CentraAlarms") {
            Some(cls) => {
                let arg = NSString::from_str(json);
                let out: Retained<NSString> = unsafe { msg_send![cls, sync: &*arg] };
                out.to_string()
            }
            None => "unavailable".into(),
        }
    }
}

#[derive(serde::Serialize)]
pub struct PushToken {
    token: String,
    problem: String,
    available: bool,
}

/// Asks iOS for the push token (the answer comes a moment later: read it with push_token).
#[tauri::command]
pub fn push_register() -> bool {
    #[cfg(target_os = "ios")]
    {
        ios::register()
    }
    #[cfg(not(target_os = "ios"))]
    {
        false
    }
}

#[tauri::command]
pub fn push_token() -> PushToken {
    #[cfg(target_os = "ios")]
    {
        let available = ios::class(c"CentraPush").is_some();
        PushToken {
            token: ios::call0(c"CentraPush", "token").unwrap_or_default(),
            problem: ios::call0(c"CentraPush", "problem").unwrap_or_default(),
            available,
        }
    }
    #[cfg(not(target_os = "ios"))]
    {
        PushToken { token: String::new(), problem: String::new(), available: false }
    }
}

/// Hands the whole alarm list to the iPhone ("ok" or "unavailable").
#[tauri::command]
pub fn alarms_sync(json: String) -> String {
    #[cfg(target_os = "ios")]
    {
        ios::alarms(&json)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = json;
        "unavailable".into()
    }
}

/// How the last alarm sync went ("ok", "denied", "error: …", or "" before the first).
#[tauri::command]
pub fn alarms_status() -> String {
    #[cfg(target_os = "ios")]
    {
        ios::call0(c"CentraAlarms", "status").unwrap_or_else(|| "unavailable".into())
    }
    #[cfg(not(target_os = "ios"))]
    {
        "unavailable".into()
    }
}

/// iPhone: shows a file in Quick Look (PowerPoint, Word, Excel, PDF, Pages …) or, with share, in the
/// share sheet (Gem i Filer, Åbn i …, AirDrop). False when this build has no CentraFiles.
#[cfg(target_os = "ios")]
pub fn show_file(path: &str, share: bool) -> bool {
    ios::file(path, share)
}
