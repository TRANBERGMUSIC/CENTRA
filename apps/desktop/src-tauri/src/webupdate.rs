//! Fast updates for the app's interface.
//!
//! The Mac app is a native shell around a web interface. Rebuilding the shell takes CI minutes, but
//! the interface changes far more often. So the interface also ships on its own: a signed `web.tar.gz`
//! on the GitHub release tagged `web`, rebuilt in about a minute on every push. This module
//!
//!   * serves the newest installed interface instead of the one built into the app (`LiveAssets`),
//!   * downloads and installs a newer one when asked (`web_update_check`),
//!   * refuses anything not signed with the same key as the app updates (minisign), anything that
//!     needs a newer native shell (`NATIVE_API`), and anything older than what it already has,
//!   * rolls back to the built-in interface if a new one never reports that it started (`web_ready`),
//!   * keeps the open vault key for exactly one reload, in memory only, so an update does not log
//!     you out (`session_stash` / `session_take`).

use std::borrow::Cow;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};

use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{App, Assets, Manager, Runtime};

/// Raise this whenever the Rust commands the interface relies on change. An interface built for a
/// higher number waits until the native app itself has been updated.
pub const NATIVE_API: u64 = include!("../native-api");

static ACTIVE: RwLock<Option<(u64, PathBuf)>> = RwLock::new(None);
static ROOT: OnceLock<PathBuf> = OnceLock::new();
static EMBEDDED: OnceLock<u64> = OnceLock::new();
static STASH: Mutex<Option<(String, Vec<u8>, Instant)>> = Mutex::new(None);

#[derive(Deserialize)]
struct WebVersion {
    version: u64,
    #[serde(rename = "needsNative", default)]
    needs_native: u64,
}

#[derive(Deserialize)]
struct Manifest {
    version: u64,
    #[serde(rename = "needsNative", default)]
    needs_native: u64,
    url: String,
    signature: String,
}

#[derive(Serialize)]
pub struct WebInfo {
    native_api: u64,
    embedded: u64,
    active: Option<u64>,
}

/* ------------------------------------------------------------------ serving */

/// The app's asset provider: the installed interface when there is one, the built-in one otherwise.
pub struct LiveAssets<R: Runtime> {
    fallback: Box<dyn Assets<R>>,
}

impl<R: Runtime> LiveAssets<R> {
    pub fn new(fallback: Box<dyn Assets<R>>) -> Self {
        let embedded = fallback
            .get(&AssetKey::from("/web-version.json"))
            .and_then(|b| serde_json::from_slice::<WebVersion>(&b).ok())
            .map(|v| v.version)
            .unwrap_or(0);
        let _ = EMBEDDED.set(embedded);
        Self { fallback }
    }
}

fn safe_rel(key: &str) -> Option<PathBuf> {
    let rel = Path::new(key.trim_start_matches('/'));
    if rel.components().all(|c| matches!(c, Component::Normal(_))) {
        Some(rel.to_path_buf())
    } else {
        None
    }
}

impl<R: Runtime> Assets<R> for LiveAssets<R> {
    fn setup(&self, app: &App<R>) {
        self.fallback.setup(app);
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let active = ACTIVE.read().ok().and_then(|a| a.clone());
        if let (Some((_, dir)), Some(rel)) = (active, safe_rel(key.as_ref())) {
            if let Ok(bytes) = fs::read(dir.join(rel)) {
                return Some(Cow::Owned(bytes));
            }
        }
        self.fallback.get(key)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.fallback.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.fallback.csp_hashes(html_path)
    }
}

/// A placeholder used only for the moment the built-in assets are swapped out of the context.
pub struct NoAssets;
impl<R: Runtime> Assets<R> for NoAssets {
    fn get(&self, _: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

/* ------------------------------------------------------------------ start-up */

fn embedded() -> u64 {
    EMBEDDED.get().copied().unwrap_or(0)
}

fn marker(root: &Path, kind: &str, v: u64) -> PathBuf {
    root.join(format!("{kind}-{v}"))
}

/// Picks the interface to serve before the window opens. A new interface gets one try; if it never
/// calls `web_ready`, the next start goes back to the built-in one and never tries that version again.
pub fn init<R: Runtime>(app: &App<R>) {
    let Ok(base) = app.path().app_data_dir() else { return };
    let root = base.join("web");
    let _ = fs::create_dir_all(&root);
    let _ = ROOT.set(root.clone());

    let current = fs::read_to_string(root.join("current")).ok().and_then(|s| s.trim().parse::<u64>().ok());
    let Some(v) = current else { return };
    let dir = root.join(v.to_string());
    let usable = v > embedded() && dir.join("index.html").is_file() && !marker(&root, "bad", v).exists();
    if !usable {
        let _ = fs::remove_file(root.join("current"));
        cleanup(&root, None);
        return;
    }
    if !marker(&root, "good", v).exists() {
        if marker(&root, "trying", v).exists() {
            // It started once already and never said it was fine: back to the built-in interface.
            let _ = fs::write(marker(&root, "bad", v), b"");
            let _ = fs::remove_file(root.join("current"));
            return;
        }
        let _ = fs::write(marker(&root, "trying", v), b"");
    }
    if let Ok(mut a) = ACTIVE.write() {
        *a = Some((v, dir));
    }
}

/// Removes every installed interface except `keep` (markers for bad versions stay).
fn cleanup(root: &Path, keep: Option<u64>) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let ver = |s: &str| s.parse::<u64>().ok();
        if e.path().is_dir() {
            let v = ver(name.trim_start_matches(".tmp-"));
            if v.is_some() && v != keep {
                let _ = fs::remove_dir_all(e.path());
            }
        } else if let Some(rest) = name.strip_prefix("trying-").or_else(|| name.strip_prefix("good-")) {
            if ver(rest) != keep {
                let _ = fs::remove_file(e.path());
            }
        }
    }
}

/* ------------------------------------------------------------------ commands */

/// The interface calls this once it has started; from then on the version counts as good.
#[tauri::command]
pub fn web_ready() {
    let (Some(root), Ok(a)) = (ROOT.get(), ACTIVE.read()) else { return };
    if let Some((v, _)) = a.as_ref() {
        let _ = fs::write(marker(root, "good", *v), b"");
        let _ = fs::remove_file(marker(root, "trying", *v));
    }
}

#[tauri::command]
pub fn web_info() -> WebInfo {
    WebInfo { native_api: NATIVE_API, embedded: embedded(), active: ACTIVE.read().ok().and_then(|a| a.as_ref().map(|x| x.0)) }
}

fn manifest_url<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    let endpoint = app.config().plugins.0.get("updater")?.get("endpoints")?.get(0)?.as_str()?.to_string();
    // https://github.com/OWNER/REPO/releases/latest/download/latest.json → …/releases/download/web/web.json
    let base = endpoint.split("/releases/").next()?;
    Some(format!("{base}/releases/download/web/web.json"))
}

fn pubkey<R: Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    Some(app.config().plugins.0.get("updater")?.get("pubkey")?.as_str()?.to_string())
}

fn b64(s: &str) -> Result<String, String> {
    let raw = base64::engine::general_purpose::STANDARD.decode(s.trim()).map_err(|e| e.to_string())?;
    String::from_utf8(raw).map_err(|e| e.to_string())
}

fn verify(data: &[u8], signature: &str, pubkey: &str) -> Result<(), String> {
    let pk = PublicKey::decode(&b64(pubkey)?).map_err(|e| format!("nøgle: {e}"))?;
    let sig = Signature::decode(&b64(signature)?).map_err(|e| format!("signatur: {e}"))?;
    pk.verify(data, &sig, true).map_err(|_| "signaturen passer ikke".to_string())
}

/// Looks for a newer interface; downloads, verifies and installs it. Returns the installed version.
#[tauri::command]
pub async fn web_update_check<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Option<u64>, String> {
    let root = ROOT.get().ok_or("ingen app-mappe")?.clone();
    let url = manifest_url(&app).ok_or("ingen opdaterings-adresse")?;
    let key = pubkey(&app).ok_or("ingen offentlig nøgle")?;
    let have = ACTIVE.read().ok().and_then(|a| a.as_ref().map(|x| x.0)).unwrap_or(0).max(embedded());

    let client = reqwest::Client::builder().timeout(Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
    let res = client.get(format!("{url}?t={}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)))
        .header("Cache-Control", "no-cache").send().await.map_err(|e| e.to_string())?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let m: Manifest = serde_json::from_slice(&res.bytes().await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if m.version <= have || m.needs_native > NATIVE_API || marker(&root, "bad", m.version).exists() {
        return Ok(None);
    }
    if !m.url.starts_with("https://github.com/") {
        return Err("ukendt adresse".into());
    }
    let data = client.get(&m.url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;
    verify(&data, &m.signature, &key)?;

    // Unpack next to the others, then check the version inside the signed archive itself, so an
    // old signed archive cannot be passed off as a new version.
    let tmp = root.join(format!(".tmp-{}", m.version));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let unpack = || -> Result<WebVersion, String> {
        let gz = flate2::read::GzDecoder::new(&data[..]);
        tar::Archive::new(gz).unpack(&tmp).map_err(|e| e.to_string())?;
        let mut s = String::new();
        fs::File::open(tmp.join("web-version.json")).and_then(|mut f| f.read_to_string(&mut s)).map_err(|e| e.to_string())?;
        serde_json::from_str::<WebVersion>(&s).map_err(|e| e.to_string())
    };
    let inner = match unpack() {
        Ok(v) => v,
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp);
            return Err(e);
        }
    };
    if inner.version != m.version || inner.needs_native > NATIVE_API || !tmp.join("index.html").is_file() {
        let _ = fs::remove_dir_all(&tmp);
        return Err("pakken passer ikke til beskrivelsen".into());
    }
    let dir = root.join(m.version.to_string());
    let _ = fs::remove_dir_all(&dir);
    fs::rename(&tmp, &dir).map_err(|e| e.to_string())?;
    fs::write(root.join("current"), m.version.to_string()).map_err(|e| e.to_string())?;
    let _ = fs::write(marker(&root, "trying", m.version), b"");
    if let Ok(mut a) = ACTIVE.write() {
        *a = Some((m.version, dir));
    }
    cleanup(&root, Some(m.version));
    Ok(Some(m.version))
}

/// Holds the open vault key across the one reload an update needs. Memory only, never on disk.
#[tauri::command]
pub fn session_stash(user: String, key: Vec<u8>) {
    if let Ok(mut s) = STASH.lock() {
        *s = Some((user, key, Instant::now()));
    }
}

/// Gives the key back once, and only within a minute of it being stashed.
#[tauri::command]
pub fn session_take() -> Option<(String, Vec<u8>)> {
    let mut s = STASH.lock().ok()?;
    let (user, key, at) = s.take()?;
    (at.elapsed() < Duration::from_secs(60)).then_some((user, key))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Signs nothing itself: point WEBUPDATE_FIXTURE at a folder with web.tar.gz, web.tar.gz.sig and
    /// k.key.pub made by `tauri signer` to run it.
    #[test]
    fn verifies_and_unpacks_a_signed_bundle() {
        let Ok(dir) = std::env::var("WEBUPDATE_FIXTURE") else { return };
        let dir = PathBuf::from(dir);
        let data = fs::read(dir.join("web.tar.gz")).unwrap();
        let sig = fs::read_to_string(dir.join("web.tar.gz.sig")).unwrap();
        let key = fs::read_to_string(dir.join("k.key.pub")).unwrap();
        verify(&data, &sig, &key).expect("valid signature");
        let mut bad = data.clone();
        let n = bad.len() / 2;
        bad[n] ^= 1;
        assert!(verify(&bad, &sig, &key).is_err(), "tampered archive must fail");
        let out = dir.join("unpacked");
        let _ = fs::remove_dir_all(&out);
        tar::Archive::new(flate2::read::GzDecoder::new(&data[..])).unpack(&out).unwrap();
        let v: WebVersion = serde_json::from_str(&fs::read_to_string(out.join("web-version.json")).unwrap()).unwrap();
        assert_eq!(v.version, 1761600000);
        assert!(out.join("index.html").is_file());
    }

    #[test]
    fn refuses_paths_outside_the_bundle() {
        assert!(safe_rel("/index.html").is_some());
        assert!(safe_rel("/assets/app.js").is_some());
        assert!(safe_rel("/../secret").is_none());
        assert!(safe_rel("/a/../../b").is_none());
    }
}
