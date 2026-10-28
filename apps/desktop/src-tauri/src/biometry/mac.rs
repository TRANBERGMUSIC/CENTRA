//! Touch ID unlock on the Mac (macOS LocalAuthentication + the login keychain).
//!
//! The vault's account key is kept in the user's login keychain (encrypted by macOS with the Mac
//! login), and CENTRA only reads it after Touch ID says yes. If fingerprints are added or removed,
//! the stored key is thrown away and the password is needed again.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::{NSError, NSString};
use objc2_local_authentication::{LABiometryType, LAContext, LAPolicy};
use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};

const SERVICE: &str = "dk.tranberg.centra.touchid";
const STATE: &str = "dk.tranberg.centra.touchid-state";

pub fn kind() -> &'static str {
    unsafe {
        let ctx = LAContext::new();
        if ctx.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics).is_err() {
            return "none";
        }
        match ctx.biometryType() {
            LABiometryType::TouchID => "touchid",
            LABiometryType::FaceID => "faceid",
            LABiometryType::OpticID => "opticid",
            _ => "none",
        }
    }
}

/// A fingerprint of the enrolled fingers: changes when one is added or removed.
#[allow(deprecated)]
fn enrolment(ctx: &LAContext) -> Vec<u8> {
    unsafe { ctx.evaluatedPolicyDomainState().map(|d| d.to_vec()).unwrap_or_default() }
}

/// Shows the Touch ID prompt. Ok(context) when the right finger was used.
fn ask(reason: &str) -> Result<objc2::rc::Retained<LAContext>, String> {
    let ctx = unsafe { LAContext::new() };
    if let Err(e) = unsafe { ctx.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics) } {
        return Err(code(e.code()));
    }
    let (tx, rx) = mpsc::channel::<Result<(), isize>>();
    let reply = RcBlock::new(move |ok: Bool, err: *mut NSError| {
        let r = if ok.as_bool() { Ok(()) } else { Err(if err.is_null() { -1 } else { unsafe { (*err).code() } }) };
        let _ = tx.send(r);
    });
    unsafe {
        ctx.setLocalizedFallbackTitle(Some(&NSString::from_str("")));
        ctx.evaluatePolicy_localizedReason_reply(LAPolicy::DeviceOwnerAuthenticationWithBiometrics, &NSString::from_str(reason), &reply);
    }
    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(Ok(())) => Ok(ctx),
        Ok(Err(c)) => Err(code(c)),
        Err(_) => Err("timeout".into()),
    }
}

fn code(c: isize) -> String {
    match c {
        -2 | -4 | -9 => "cancel",
        -1 => "failed",
        -3 => "fallback",
        -5 => "no-passcode",
        -6 => "unavailable",
        -7 => "not-enrolled",
        -8 => "lockout",
        _ => "error",
    }
    .into()
}

/// Turns Touch ID unlock on: confirms the finger, then keeps the key in the keychain.
pub fn enable(user: &str, key: &[u8]) -> Result<(), String> {
    let ctx = ask("slå Touch ID til for CENTRA")?;
    set_generic_password(SERVICE, user, key).map_err(|e| e.to_string())?;
    set_generic_password(STATE, user, &enrolment(&ctx)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Unlocks with Touch ID: the finger first, then the key from the keychain.
pub fn unlock(user: &str) -> Result<Vec<u8>, String> {
    let ctx = ask("låse CENTRA op")?;
    let saved = get_generic_password(STATE, user).unwrap_or_default();
    if !saved.is_empty() && saved != enrolment(&ctx) {
        disable(user);
        return Err("changed".into());
    }
    get_generic_password(SERVICE, user).map_err(|_| "missing".to_string())
}

pub fn disable(user: &str) {
    let _ = delete_generic_password(SERVICE, user);
    let _ = delete_generic_password(STATE, user);
}
