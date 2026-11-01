//! "Hey Siri, husk i CENTRA": the iPhone's Siri action (scripts/ios/CentraIntents.swift) puts what you
//! said in a small inbox in the app's own settings (never leaves the phone), and the app hands it to
//! Assist the next time it's open, which makes the reminder with the right time.

const INBOX: &str = "centra.siri.inbox";

/// What Siri was told since the app last looked (and empties the inbox). Empty on the Mac.
#[tauri::command]
pub fn siri_inbox() -> Vec<String> {
    #[cfg(target_os = "ios")]
    {
        use objc2_foundation::{NSString, NSUserDefaults};
        let defaults = NSUserDefaults::standardUserDefaults();
        let key = NSString::from_str(INBOX);
        let out: Vec<String> = match defaults.stringArrayForKey(&key) {
            Some(list) => list.to_vec().iter().map(|s| s.to_string()).filter(|s| !s.trim().is_empty()).collect(),
            None => Vec::new(),
        };
        if !out.is_empty() {
            defaults.removeObjectForKey(&key);
        }
        out
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = INBOX;
        Vec::new()
    }
}
