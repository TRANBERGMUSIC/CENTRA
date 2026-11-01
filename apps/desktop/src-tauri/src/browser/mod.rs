//! CENTRA's own browser: a separate window with a toolbar (CENTRA's own page, `browser.html`) and the
//! web page under it in its own web view.
//!
//! Safety:
//! - The page view shows other people's websites. It has no access to CENTRA's commands or data:
//!   Tauri refuses commands from remote addresses, no capability names its label, and it can't
//!   navigate to CENTRA's own pages (only http, https, about: and data/blob).
//! - Normal mode keeps its cookies in a store of its own (not CENTRA's), separate for with and without
//!   VPN, so a site can't connect the two. Private mode keeps nothing: it's gone when the page closes.
//! - VPN: every request from the page goes through `relay` → your VPN server. If that fails, pages
//!   don't load (no silent fallback to your own connection), and WebRTC is turned off so it can't
//!   reveal your real address.

pub mod relay;
pub mod wg;

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Url, Webview, WebviewUrl, Window};
use tauri_plugin_opener::OpenerExt;

const WINDOW: &str = "browser";
const UI: &str = "browser-ui";
const BAR: f64 = 52.0;
/// Cookie stores for normal mode (fixed ids, so logins survive restarts). With VPN uses its own.
const STORE_DIRECT: [u8; 16] = *b"centra-browser-1";
const STORE_VPN: [u8; 16] = *b"centra-brwsr-vpn";

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cfg {
    #[serde(default)]
    pub incognito: bool,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub vpn_on: bool,
    /// The VPN in use from Indstillinger (also when it's switched off, so the toolbar can switch it on).
    pub vpn: Option<relay::Vpn>,
    /// All your VPNs, to switch between in the toolbar.
    #[serde(default)]
    pub vpns: Vec<relay::Vpn>,
}

#[derive(Serialize, Clone, Default)]
pub struct VpnChoice {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Default)]
pub struct State {
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub incognito: bool,
    pub vpn_on: bool,
    pub vpn_name: String,
    pub vpn_available: bool,
    pub vpn_error: String,
    pub vpn_id: String,
    pub vpns: Vec<VpnChoice>,
}

fn vpn_label(v: &relay::Vpn) -> String {
    if !v.name.is_empty() { v.name.clone() } else if !v.host.is_empty() { v.host.clone() } else { "VPN".into() }
}

#[derive(Default)]
struct Inner {
    cfg: Cfg,
    relay: Option<relay::Relay>,
    page: Option<String>,
    /// How the current page view was made: (private, VPN server or none).
    made_with: Option<(bool, Option<relay::Vpn>)>,
    state: State,
    counter: u32,
    last_error: Option<(String, Instant)>,
}

#[derive(Default)]
pub struct Browser(Arc<Mutex<Inner>>);

fn emit_state<R: Runtime>(app: &AppHandle<R>) {
    let b = app.state::<Browser>();
    let s = b.0.lock().unwrap().state.clone();
    let _ = app.emit_to(UI, "browser-state", s);
}

fn update<R: Runtime>(app: &AppHandle<R>, f: impl FnOnce(&mut State)) {
    {
        let b = app.state::<Browser>();
        let mut i = b.0.lock().unwrap();
        f(&mut i.state);
    }
    emit_state(app);
}

/// What you type in the address field: an address, or something to search for.
pub fn resolve(input: &str, search: &str) -> Option<Url> {
    let t = input.trim();
    if t.is_empty() { return None; }
    if let Ok(u) = Url::parse(t) {
        if matches!(u.scheme(), "http" | "https") { return Some(u); }
    }
    let looks_like_host = !t.contains(char::is_whitespace) && (t.contains('.') || t.starts_with("localhost")) && !t.ends_with('.');
    if looks_like_host {
        if let Ok(u) = Url::parse(&format!("https://{t}")) { return Some(u); }
    }
    let q: String = url_escape(t);
    let base = match search {
        "google" => "https://www.google.com/search?q=",
        "startpage" => "https://www.startpage.com/sp/search?query=",
        _ => "https://duckduckgo.com/?q=",
    };
    Url::parse(&format!("{base}{q}")).ok()
}

fn url_escape(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        b' ' => "+".into(),
        _ => format!("%{b:02X}"),
    }).collect()
}

/// Only web pages in the page view (never CENTRA's own pages or other schemes).
pub fn allowed(u: &Url) -> bool {
    // *.localhost is where Tauri serves app pages and IPC on some systems: never in the page view.
    if u.host_str().is_some_and(|h| h.ends_with(".localhost")) { return false; }
    matches!(u.scheme(), "http" | "https" | "blob" | "data") || u.as_str() == "about:blank" || u.as_str().starts_with("about:srcdoc")
}

fn layout<R: Runtime>(window: &Window<R>) {
    let Ok(size) = window.inner_size() else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (w, h) = (size.width as f64 / scale, size.height as f64 / scale);
    for wv in window.webviews() {
        let (y, height) = if wv.label() == UI { (0.0, BAR) } else { (BAR, (h - BAR).max(0.0)) };
        let _ = wv.set_position(LogicalPosition::new(0.0, y));
        let _ = wv.set_size(LogicalSize::new(w, height));
    }
}

fn ensure_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Window<R>> {
    if let Some(w) = app.get_window(WINDOW) { return Ok(w); }
    let builder = tauri::window::WindowBuilder::new(app, WINDOW).title("CENTRA Browser").inner_size(1240.0, 860.0).min_inner_size(560.0, 420.0);
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    let window = builder.build()?;
    let size = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
    window.add_child(WebviewBuilder::new(UI, WebviewUrl::App("browser.html".into())), LogicalPosition::new(0.0, 0.0), LogicalSize::new(size.width, BAR))?;
    let handle = app.clone();
    window.on_window_event(move |ev| match ev {
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. } => {
            if let Some(w) = handle.get_window(WINDOW) { layout(&w); }
        }
        tauri::WindowEvent::Destroyed => {
            // Closing the window ends private mode and the VPN connection.
            let b = handle.state::<Browser>();
            let mut i = b.0.lock().unwrap();
            i.relay = None;
            i.page = None;
            i.made_with = None;
        }
        _ => {}
    });
    Ok(window)
}

fn page<R: Runtime>(app: &AppHandle<R>) -> Option<Webview<R>> {
    let label = app.state::<Browser>().0.lock().unwrap().page.clone()?;
    app.get_webview(&label)
}

/// Downloads go to Overførsler with a name that doesn't overwrite anything.
fn download_path<R: Runtime>(app: &AppHandle<R>, suggested: &std::path::Path, url: &Url) -> std::path::PathBuf {
    let dir = app.path().download_dir().unwrap_or_else(|_| std::env::temp_dir());
    let name = suggested.file_name().map(|n| n.to_string_lossy().to_string()).filter(|n| !n.is_empty())
        .or_else(|| url.path_segments().and_then(|mut s| s.next_back().map(|x| x.to_string())).filter(|n| !n.is_empty()))
        .unwrap_or_else(|| "download".into());
    let name: String = name.chars().map(|c| if c == '/' || c == '\\' || c == ':' { '_' } else { c }).collect();
    let name = name.trim_start_matches('.').to_string();
    let (stem, ext) = match name.rfind('.') { Some(i) if i > 0 => (name[..i].to_string(), name[i..].to_string()), _ => (name.clone(), String::new()) };
    let mut p = dir.join(&name);
    let mut n = 2;
    while p.exists() { p = dir.join(format!("{stem} ({n}){ext}")); n += 1; }
    p
}

/// Script run in every page: with VPN on, WebRTC is switched off so it can't reveal your real address.
fn init_script(vpn: bool) -> String {
    if !vpn { return String::new(); }
    r#"(() => { try {
  for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) { try { Object.defineProperty(window, k, { value: undefined, configurable: false, writable: false }); } catch (e) {} }
} catch (e) {} })();"#.into()
}

/// (Re)makes the page view: needed when private mode or the VPN changes, as both are fixed per view.
async fn make_page<R: Runtime>(app: &AppHandle<R>, url: Url) -> Result<(), String> {
    let window = ensure_window(app).map_err(|e| e.to_string())?;
    let (incognito, vpn, label, old) = {
        let b = app.state::<Browser>();
        let mut i = b.0.lock().unwrap();
        i.counter += 1;
        let vpn = if i.cfg.vpn_on { i.cfg.vpn.clone() } else { None };
        (i.cfg.incognito, vpn, format!("browser-page-{}", i.counter), i.page.clone())
    };
    // The VPN relay for this server (kept if it's the same server).
    let mut proxy: Option<Url> = None;
    if let Some(v) = &vpn {
        let have = app.state::<Browser>().0.lock().unwrap().relay.as_ref().filter(|r| &r.vpn == v).map(|r| r.port);
        let port = match have {
            Some(p) => p,
            None => {
                let handle = app.clone();
                let on_err: relay::OnError = Arc::new(move |msg: String| {
                    if msg.is_empty() { return; }
                    let b = handle.state::<Browser>();
                    let fresh = {
                        let mut i = b.0.lock().unwrap();
                        let fresh = i.last_error.as_ref().map_or(true, |(m, t)| m != &msg || t.elapsed() > Duration::from_secs(8));
                        if fresh { i.last_error = Some((msg.clone(), Instant::now())); i.state.vpn_error = msg.clone(); }
                        fresh
                    };
                    if fresh { emit_state(&handle); }
                });
                let r = relay::start(v.clone(), on_err).await.map_err(|e| format!("VPN'en kunne ikke startes ({e})"))?;
                let p = r.port;
                app.state::<Browser>().0.lock().unwrap().relay = Some(r);
                p
            }
        };
        proxy = Some(Url::parse(&format!("socks5://127.0.0.1:{port}")).map_err(|e| e.to_string())?);
    } else {
        app.state::<Browser>().0.lock().unwrap().relay = None;
    }

    let h_nav = app.clone();
    let h_new = app.clone();
    let h_load = app.clone();
    let h_title = app.clone();
    let h_dl = app.clone();
    let mut b = WebviewBuilder::new(&label, WebviewUrl::External(url.clone()))
        .incognito(incognito)
        .initialization_script(init_script(vpn.is_some()))
        .on_navigation(move |u| {
            if allowed(u) { return true; }
            if matches!(u.scheme(), "mailto" | "tel" | "sms" | "facetime" | "maps") { let _ = h_nav.opener().open_url(u.as_str(), None::<&str>); }
            false
        })
        // Links that want a new window open in the same view instead (no pop-ups).
        .on_new_window(move |u, _| {
            if allowed(&u) && u.scheme().starts_with("http") {
                if let Some(p) = page(&h_new) { let _ = p.navigate(u); }
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_wv, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            let u = payload.url().to_string();
            update(&h_load, |s| { s.url = u; s.loading = loading; if loading { s.vpn_error.clear(); } });
        })
        .on_document_title_changed(move |_wv, title| update(&h_title, |s| s.title = title))
        .on_download(move |_wv, ev| {
            match ev {
                DownloadEvent::Requested { url, destination } => {
                    let p = download_path(&h_dl, destination, &url);
                    let _ = h_dl.emit_to(UI, "browser-download", serde_json::json!({ "name": p.file_name().map(|n| n.to_string_lossy().to_string()), "path": p.to_string_lossy(), "done": false }));
                    *destination = p;
                }
                DownloadEvent::Finished { success, .. } => {
                    let _ = h_dl.emit_to(UI, "browser-download", serde_json::json!({ "done": true, "ok": success }));
                }
                _ => {}
            }
            true
        });
    if !incognito {
        b = b.data_store_identifier(if vpn.is_some() { STORE_VPN } else { STORE_DIRECT });
    }
    if let Some(p) = proxy { b = b.proxy_url(p); }

    let size = window.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(window.scale_factor().unwrap_or(1.0));
    window.add_child(b, LogicalPosition::new(0.0, BAR), LogicalSize::new(size.width, (size.height - BAR).max(0.0))).map_err(|e| e.to_string())?;
    if let Some(old) = old.and_then(|l| app.get_webview(&l)) { let _ = old.close(); }
    {
        let b = app.state::<Browser>();
        let mut i = b.0.lock().unwrap();
        i.page = Some(label);
        i.made_with = Some((incognito, vpn.clone()));
        let vpn_available = i.cfg.vpn.is_some();
        let vpn_name = i.cfg.vpn.as_ref().map(vpn_label).unwrap_or_default();
        let vpn_id = i.cfg.vpn.as_ref().map(|v| v.id.clone()).unwrap_or_default();
        let vpns = i.cfg.vpns.iter().map(|v| VpnChoice { id: v.id.clone(), name: vpn_label(v) }).collect();
        i.state = State { url: url.to_string(), title: String::new(), loading: true, incognito, vpn_on: vpn.is_some(), vpn_name, vpn_available, vpn_error: String::new(), vpn_id, vpns };
    }
    emit_state(app);
    Ok(())
}

/// Opens a web address in the browser window (makes the window when needed, and brings it forward).
#[tauri::command]
pub async fn browser_open<R: Runtime>(app: AppHandle<R>, url: String, cfg: Cfg) -> Result<(), String> {
    let u = Url::parse(url.trim()).map_err(|_| "Ugyldigt link".to_string())?;
    if !matches!(u.scheme(), "http" | "https") {
        return app.opener().open_url(u.as_str(), None::<&str>).map_err(|e| e.to_string());
    }
    let same = {
        let b = app.state::<Browser>();
        let mut i = b.0.lock().unwrap();
        // A link from CENTRA keeps what you chose in the window (private / VPN) while it's open.
        let open = i.page.is_some() && app.get_window(WINDOW).is_some();
        let keep = if open { Some((i.cfg.incognito, i.cfg.vpn_on)) } else { None };
        i.cfg = cfg;
        if let Some((inc, on)) = keep { i.cfg.incognito = inc; i.cfg.vpn_on = on; }
        let want = (i.cfg.incognito, if i.cfg.vpn_on { i.cfg.vpn.clone() } else { None });
        open && i.made_with.as_ref() == Some(&want)
    };
    match (same, page(&app)) {
        (true, Some(p)) => p.navigate(u).map_err(|e| e.to_string())?,
        _ => make_page(&app, u).await?,
    }
    if let Some(w) = app.get_window(WINDOW) { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); }
    Ok(())
}

/// The toolbar asks for the current state when it loads.
#[tauri::command]
pub fn browser_state<R: Runtime>(app: AppHandle<R>) -> State {
    app.state::<Browser>().0.lock().unwrap().state.clone()
}

/// Address field: go to an address, or search.
#[tauri::command]
pub async fn browser_go<R: Runtime>(app: AppHandle<R>, input: String) -> Result<(), String> {
    let search = app.state::<Browser>().0.lock().unwrap().cfg.search.clone();
    let u = resolve(&input, &search).ok_or("Skriv en adresse eller noget at søge efter")?;
    match page(&app) {
        Some(p) => p.navigate(u).map_err(|e| e.to_string()),
        None => make_page(&app, u).await,
    }
}

/// Back, forward, reload, stop.
#[tauri::command]
pub fn browser_nav<R: Runtime>(app: AppHandle<R>, action: String) -> Result<(), String> {
    let p = page(&app).ok_or("Ingen side åben")?;
    match action.as_str() {
        "back" => p.eval("history.back()"),
        "forward" => p.eval("history.forward()"),
        "reload" => p.reload(),
        "stop" => p.eval("window.stop()"),
        _ => return Err("Ukendt handling".into()),
    }
    .map_err(|e| e.to_string())
}

/// Switch private mode or the VPN from the toolbar: the page is opened again with the new setting,
/// and CENTRA remembers the choice.
#[tauri::command]
pub async fn browser_toggle<R: Runtime>(app: AppHandle<R>, incognito: Option<bool>, vpn_on: Option<bool>, vpn_id: Option<String>) -> Result<(), String> {
    let url = {
        let b = app.state::<Browser>();
        let mut i = b.0.lock().unwrap();
        if let Some(x) = incognito { i.cfg.incognito = x; }
        if let Some(id) = &vpn_id {
            let v = i.cfg.vpns.iter().find(|v| &v.id == id).cloned().ok_or("Den VPN findes ikke længere")?;
            i.cfg.vpn = Some(v);
            i.cfg.vpn_on = true;
        }
        if let Some(x) = vpn_on {
            if x && i.cfg.vpn.is_none() { return Err("Sæt VPN op i CENTRA under Indstillinger → Browser først".into()); }
            i.cfg.vpn_on = x;
        }
        i.last_error = None;
        i.state.url.clone()
    };
    let vpn_on = if vpn_id.is_some() { Some(true) } else { vpn_on };
    let _ = app.emit_to("main", "browser-prefs", serde_json::json!({ "incognito": incognito, "vpnOn": vpn_on, "vpnActive": vpn_id }));
    let u = Url::parse(&url).ok().filter(allowed).filter(|u| u.scheme().starts_with("http")).unwrap_or_else(|| Url::parse("https://duckduckgo.com/").unwrap());
    make_page(&app, u).await
}

/// Forgets cookies, logins and history of the browser (the store in use).
#[tauri::command]
pub fn browser_clear<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let p = page(&app).ok_or("Ingen side åben")?;
    p.clear_all_browsing_data().map_err(|e| e.to_string())?;
    p.reload().map_err(|e| e.to_string())
}

/// The current page in Safari (or the Mac's default browser).
#[tauri::command]
pub fn browser_external<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let url = app.state::<Browser>().0.lock().unwrap().state.url.clone();
    if url.is_empty() { return Err("Ingen side åben".into()); }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Shows a downloaded file in Finder.
#[tauri::command]
pub fn browser_reveal<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let p = std::path::PathBuf::from(&path);
    if !p.starts_with(&dir) { return Err("Kun filer i Overførsler".into()); }
    app.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
}

/// Tests the VPN server from Indstillinger: the address and country websites will see.
#[tauri::command]
pub async fn browser_vpn_test(vpn: relay::Vpn) -> Result<relay::Check, String> {
    relay::check(&vpn).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_or_search() {
        assert_eq!(resolve("dr.dk", "").unwrap().as_str(), "https://dr.dk/");
        assert_eq!(resolve("https://lunchhub.dk/inbox", "").unwrap().as_str(), "https://lunchhub.dk/inbox");
        assert_eq!(resolve("http://localhost:5173", "").unwrap().as_str(), "http://localhost:5173/");
        assert_eq!(resolve("bedste pizza nørrebro", "duckduckgo").unwrap().as_str(), "https://duckduckgo.com/?q=bedste+pizza+n%C3%B8rrebro");
        assert_eq!(resolve("vejret", "google").unwrap().as_str(), "https://www.google.com/search?q=vejret");
        assert!(resolve("   ", "").is_none());
        assert_eq!(resolve("javascript:alert(1)", "").unwrap().host_str(), Some("duckduckgo.com")); // never run as an address
    }

    #[test]
    fn page_view_only_shows_web_pages() {
        for ok in ["https://dr.dk", "http://example.com", "about:blank", "data:text/html,hej", "blob:https://x.dk/123"] { assert!(allowed(&Url::parse(ok).unwrap()), "{ok}"); }
        for no in ["tauri://localhost/index.html", "file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.dk", "centra://x", "http://ipc.localhost/x", "https://tauri.localhost/"] {
            assert!(!allowed(&Url::parse(no).unwrap()), "{no}");
        }
    }

    #[test]
    fn cfg_from_the_app() {
        let c: Cfg = serde_json::from_value(serde_json::json!({ "incognito": true, "search": "duckduckgo", "vpnOn": true, "vpn": { "kind": "socks5", "host": "se.vpn.example", "port": 1080, "user": "u", "pass": "p", "name": "Sverige" } })).unwrap();
        assert!(c.incognito && c.vpn_on);
        assert_eq!(c.vpn.unwrap().name, "Sverige");
        assert!(serde_json::from_value::<Cfg>(serde_json::json!({ "incognito": false, "vpn": null })).unwrap().vpn.is_none());
    }
}
