//! Mail for CENTRA: IMAP (read, flags, archive) and SMTP (send), plus fetching calendar feeds.
//!
//! The app's web layer can't open TCP connections, so these run here in Rust. Passwords are
//! handed in per call from CENTRA's encrypted store and are never written to disk by this module.

use mail_parser::{Address, HeaderValue, MessageParser, MimeHeaders};
use serde::{Deserialize, Serialize};
use std::net::TcpStream;
use std::time::Duration;

#[derive(Deserialize, Clone)]
pub struct Account {
    pub host: String,
    pub port: u16,
    /// "tls" (implicit, 993), "starttls" (143) or "none" (only allowed for localhost).
    pub security: String,
    pub user: String,
    pub pass: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_security: String,
    pub from_name: Option<String>,
    pub from_email: Option<String>,
}

#[derive(Serialize)]
pub struct Msg {
    pub uid: u32,
    pub message_id: String,
    pub in_reply_to: String,
    pub references: String,
    pub from_name: String,
    pub from_email: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub subject: String,
    pub date: String,
    pub text: String,
    pub seen: bool,
    pub flagged: bool,
    pub answered: bool,
    pub attachments: Vec<String>,
    pub list: bool,
    /// The mail as it was designed (empty when it is plain text or too big). Shown in a sandbox.
    pub html: String,
    /// Attachments and inline images: what they are, so the interface can fetch one when needed.
    pub parts: Vec<Part>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Part {
    /// Position among the message's attachments (what `mail_part` takes).
    pub index: u32,
    pub name: String,
    pub mime: String,
    pub size: usize,
    /// Content-ID, for <img src="cid:…"> in the HTML.
    pub cid: String,
    pub inline: bool,
}

#[derive(Serialize)]
pub struct PartData {
    pub name: String,
    pub mime: String,
    /// base64
    pub data: String,
}

/// The body and parts of one message, for mails fetched before CENTRA kept the HTML.
#[derive(Serialize)]
pub struct Body {
    pub text: String,
    pub html: String,
    pub parts: Vec<Part>,
}

#[derive(Serialize)]
pub struct Fetched {
    /// The folder actually read (the server's own name for "Sent" when asked for SENT).
    pub folder: String,
    pub uid_validity: u32,
    pub messages: Vec<Msg>,
    pub exists: u32,
}

trait Stream: std::io::Read + std::io::Write {}
impl<T: std::io::Read + std::io::Write> Stream for T {}
type Session = imap::Session<Box<dyn Stream + Send>>;

fn err<E: std::fmt::Display>(what: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{what}: {e}")
}

fn friendly(e: String) -> String {
    let l = e.to_lowercase();
    if l.contains("authenticat") || l.contains("login") || l.contains("invalid credentials") || l.contains("no [auth") {
        return "Login blev afvist. Tjek e-mail og adgangskode (Gmail og iCloud kræver en app-adgangskode).".into();
    }
    if l.contains("failed to lookup") || l.contains("dns") || l.contains("name or service") || l.contains("nodename") {
        return "Serveren blev ikke fundet. Tjek servernavnet, eller om du er online.".into();
    }
    if l.contains("timed out") || l.contains("refused") {
        return "Ingen forbindelse til serveren. Tjek server og port, eller om du er online.".into();
    }
    e
}

fn tcp(host: &str, port: u16) -> Result<TcpStream, String> {
    use std::net::ToSocketAddrs;
    let addr = (host, port).to_socket_addrs().map_err(err("DNS"))?.next().ok_or("Serveren blev ikke fundet")?;
    let s = TcpStream::connect_timeout(&addr, Duration::from_secs(15)).map_err(err("Forbindelse"))?;
    s.set_read_timeout(Some(Duration::from_secs(60))).ok();
    s.set_write_timeout(Some(Duration::from_secs(30))).ok();
    Ok(s)
}

/// Reads one CRLF-terminated line byte by byte, so nothing meant for TLS is consumed.
fn line(s: &mut TcpStream) -> Result<String, String> {
    use std::io::Read;
    let mut out = Vec::new();
    let mut b = [0u8; 1];
    while out.len() < 8192 {
        if s.read(&mut b).map_err(err("IMAP"))? == 0 { break; }
        out.push(b[0]);
        if out.ends_with(b"\r\n") { break; }
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}

/// Plain IMAP greeting, then STARTTLS; the stream is ready for the TLS handshake afterwards.
fn starttls(s: &mut TcpStream) -> Result<(), String> {
    use std::io::Write;
    let greet = line(s)?;
    if !greet.starts_with("* OK") { return Err(format!("IMAP: {greet}")); }
    s.write_all(b"c0 STARTTLS\r\n").map_err(err("IMAP"))?;
    loop {
        let l = line(s)?;
        if l.is_empty() { return Err("IMAP: forbindelsen lukkede".into()); }
        if l.starts_with("c0 ") {
            return if l.starts_with("c0 OK") { Ok(()) } else { Err(format!("STARTTLS: {l}")) };
        }
    }
}

fn local(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1" || host == "::1"
}

fn connect(a: &Account) -> Result<Session, String> {
    let tls = native_tls::TlsConnector::builder().build().map_err(err("TLS"))?;
    let stream = tcp(&a.host, a.port)?;
    let client: imap::Client<Box<dyn Stream + Send>> = match a.security.as_str() {
        "tls" => {
            let s = tls.connect(&a.host, stream).map_err(err("TLS"))?;
            let mut c = imap::Client::new(Box::new(s) as Box<dyn Stream + Send>);
            c.read_greeting().map_err(err("IMAP"))?;
            c
        }
        "starttls" => {
            let mut stream = stream;
            starttls(&mut stream)?;
            let s = tls.connect(&a.host, stream).map_err(err("TLS"))?;
            imap::Client::new(Box::new(s) as Box<dyn Stream + Send>)
        }
        "none" if local(&a.host) => {
            let mut c = imap::Client::new(Box::new(stream) as Box<dyn Stream + Send>);
            c.read_greeting().map_err(err("IMAP"))?;
            c
        }
        _ => return Err("Ukrypteret forbindelse er ikke tilladt".into()),
    };
    client.login(&a.user, &a.pass).map_err(|(e, _)| format!("login: {e}"))
}

fn addr_list(a: Option<&Address>) -> Vec<(String, String)> {
    let mut out = vec![];
    if let Some(a) = a {
        for x in a.iter() {
            out.push((x.name().unwrap_or("").to_string(), x.address().unwrap_or("").to_string()));
        }
    }
    out
}

fn header_text(v: &HeaderValue) -> String {
    match v {
        HeaderValue::Text(t) => t.to_string(),
        HeaderValue::TextList(l) => l.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(" "),
        _ => String::new(),
    }
}

/// HTML-only mails: keep the readable text, drop tags, scripts and styles.
fn strip_html(h: &str) -> String {
    let mut out = String::with_capacity(h.len() / 2);
    let lower = h.to_ascii_lowercase();
    let (mut i, b) = (0usize, h.as_bytes());
    while i < b.len() {
        if b[i] == b'<' {
            for skip in ["<script", "<style", "<head"] {
                if lower[i..].starts_with(skip) {
                    let close = format!("</{}", &skip[1..]);
                    if let Some(j) = lower[i..].find(&close) { i += j; }
                }
            }
            let tag_end = h[i..].find('>').map(|j| i + j + 1).unwrap_or(b.len());
            let tag = &lower[i..tag_end];
            if tag.starts_with("<br") || tag.starts_with("<p") || tag.starts_with("</p") || tag.starts_with("<div") || tag.starts_with("</div") || tag.starts_with("<tr") || tag.starts_with("<li") || tag.starts_with("<h") {
                out.push('\n');
            }
            i = tag_end;
        } else {
            let next = h[i..].find('<').map(|j| i + j).unwrap_or(b.len());
            out.push_str(&h[i..next]);
            i = next;
        }
    }
    let out = out.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&aelig;", "æ").replace("&oslash;", "ø").replace("&aring;", "å").replace("&AElig;", "Æ").replace("&Oslash;", "Ø").replace("&Aring;", "Å");
    let mut clean = String::new();
    let mut blank = 0;
    for line in out.lines() {
        let t = line.trim();
        if t.is_empty() { blank += 1; if blank > 1 { continue; } } else { blank = 0; }
        clean.push_str(t);
        clean.push('\n');
    }
    clean.trim().to_string()
}

const HTML_MAX: usize = 600_000;

fn parts_of(m: &mail_parser::Message) -> Vec<Part> {
    m.attachments()
        .enumerate()
        .map(|(i, a)| {
            let mime = a
                .content_type()
                .map(|c| format!("{}/{}", c.ctype(), c.subtype().unwrap_or("octet-stream")))
                .unwrap_or_else(|| "application/octet-stream".into())
                .to_lowercase();
            let cid = a.content_id().unwrap_or("").trim().trim_matches(|c| c == '<' || c == '>').to_string();
            let inline = a.content_disposition().map(|d| d.ctype().eq_ignore_ascii_case("inline")).unwrap_or(!cid.is_empty());
            let fallback = if mime.starts_with("image/") { "billede" } else if a.is_message() { "videresendt mail.eml" } else { "vedhæftning" };
            Part { index: i as u32, name: a.attachment_name().unwrap_or(fallback).to_string(), mime, size: a.len(), cid, inline }
        })
        .collect()
}

/// Every text/html body part, joined (Apple Mail splits a mail around inline images).
fn html_of(m: &mail_parser::Message) -> String {
    let mut out = String::new();
    for p in m.html_bodies() {
        if p.is_text_html() {
            if let Some(t) = p.text_contents() { out.push_str(t); }
        }
    }
    if out.len() > HTML_MAX { String::new() } else { out }
}

fn text_of(m: &mail_parser::Message) -> String {
    let mut text = m.body_text(0).map(|t| t.to_string()).unwrap_or_default();
    if text.trim().is_empty() {
        if let Some(h) = m.body_html(0) { text = strip_html(&h); }
    }
    if text.len() > 60_000 {
        let mut cut = 60_000;
        while !text.is_char_boundary(cut) { cut -= 1; }
        text.truncate(cut);
    }
    text
}

fn parse(uid: u32, raw: &[u8], flags: &[imap::types::Flag]) -> Option<Msg> {
    let m = MessageParser::default().parse(raw)?;
    let from = addr_list(m.from()).into_iter().next().unwrap_or_default();
    let text = text_of(&m);
    let html = html_of(&m);
    let parts = parts_of(&m);
    let attachments = m.attachments().map(|a| a.attachment_name().unwrap_or("vedhæftning").to_string()).collect();
    use imap::types::Flag;
    Some(Msg {
        uid,
        message_id: m.message_id().unwrap_or("").to_string(),
        in_reply_to: header_text(m.in_reply_to()),
        references: header_text(m.references()),
        from_name: from.0,
        from_email: from.1,
        to: addr_list(m.to()).into_iter().map(|x| x.1).collect(),
        cc: addr_list(m.cc()).into_iter().map(|x| x.1).collect(),
        subject: m.subject().unwrap_or("").to_string(),
        date: m.date().map(|d| d.to_rfc3339()).unwrap_or_default(),
        text,
        seen: flags.iter().any(|f| matches!(f, Flag::Seen)),
        flagged: flags.iter().any(|f| matches!(f, Flag::Flagged)),
        answered: flags.iter().any(|f| matches!(f, Flag::Answered)),
        attachments,
        list: m.header("List-Unsubscribe").is_some() || m.header("List-Id").is_some(),
        html,
        parts,
    })
}

/// The raw message for one UID (looks in the given folder, INBOX by default).
fn raw_blocking(a: &Account, folder: &str, uid: u32) -> Result<Vec<u8>, String> {
    let mut s = connect(a)?;
    s.select(folder).map_err(err("Mappe"))?;
    let fetched = s.uid_fetch(uid.to_string(), "(UID BODY.PEEK[])").map_err(err("Hentning"))?;
    let raw = fetched.iter().find_map(|f| f.body().map(|b| b.to_vec())).ok_or("Mailen findes ikke længere i indbakken på serveren (måske arkiveret eller slettet).")?;
    let _ = s.logout();
    Ok(raw)
}

fn part_blocking(a: &Account, folder: &str, uid: u32, index: u32) -> Result<(String, String, Vec<u8>), String> {
    let raw = raw_blocking(a, folder, uid)?;
    let m = MessageParser::default().parse(&raw).ok_or("Mailen kunne ikke læses")?;
    let meta = parts_of(&m).into_iter().nth(index as usize).ok_or("Vedhæftningen findes ikke")?;
    let part = m.attachment(index).ok_or("Vedhæftningen findes ikke")?;
    Ok((meta.name, meta.mime, part.contents().to_vec()))
}

/// A file name that is safe to write: no folders, no hidden files, no odd characters.
fn safe_name(name: &str) -> String {
    let n: String = name.chars().map(|c| if c == '/' || c == '\\' || c == ':' || c.is_control() { '_' } else { c }).collect();
    let n = n.trim().trim_start_matches('.').to_string();
    if n.is_empty() { "vedhæftning".into() } else { n }
}

fn free_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let p = dir.join(name);
    if !p.exists() { return p; }
    let (stem, ext) = match name.rfind('.') { Some(i) if i > 0 => (&name[..i], &name[i..]), _ => (name, "") };
    (2..1000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(p)
}

#[tauri::command]
pub async fn mail_body(account: Account, uid: u32, folder: Option<String>) -> Result<Body, String> {
    let folder = folder.unwrap_or_else(|| "INBOX".into());
    tauri::async_runtime::spawn_blocking(move || {
        let raw = raw_blocking(&account, &folder, uid)?;
        let m = MessageParser::default().parse(&raw).ok_or("Mailen kunne ikke læses")?;
        Ok(Body { text: text_of(&m), html: html_of(&m), parts: parts_of(&m) })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(friendly)
}

/// One attachment or inline image, as base64 (for previews; at most 30 MB).
#[tauri::command]
pub async fn mail_part(account: Account, uid: u32, index: u32, folder: Option<String>) -> Result<PartData, String> {
    let folder = folder.unwrap_or_else(|| "INBOX".into());
    tauri::async_runtime::spawn_blocking(move || {
        let (name, mime, data) = part_blocking(&account, &folder, uid, index)?;
        if data.len() > 30_000_000 { return Err("Filen er for stor til at vise her. Brug Gem eller Åbn.".to_string()); }
        use base64::Engine;
        Ok(PartData { name, mime, data: base64::engine::general_purpose::STANDARD.encode(data) })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(friendly)
}

/// Saves an attachment to Overførsler (save = true) or opens it in its own app (Preview, Pages …).
#[tauri::command]
pub async fn mail_save_part<R: tauri::Runtime>(app: tauri::AppHandle<R>, account: Account, uid: u32, index: u32, save: bool, folder: Option<String>) -> Result<String, String> {
    use tauri::Manager;
    use tauri_plugin_opener::OpenerExt;
    let folder = folder.unwrap_or_else(|| "INBOX".into());
    let dir = if save {
        app.path().download_dir().map_err(|e| e.to_string())?
    } else {
        std::env::temp_dir().join("CENTRA vedhæftninger")
    };
    let path = tauri::async_runtime::spawn_blocking(move || -> Result<std::path::PathBuf, String> {
        let (name, _, data) = part_blocking(&account, &folder, uid, index)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = free_path(&dir, &safe_name(&name));
        std::fs::write(&path, data).map_err(|e| e.to_string())?;
        Ok(path)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(friendly)?;
    if save {
        let _ = app.opener().reveal_item_in_dir(&path);
    } else {
        app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

fn imap_date(days_back: u32) -> String {
    let t = std::time::SystemTime::now() - Duration::from_secs(days_back as u64 * 86_400);
    let secs = t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (y, mo, d) = civil(secs.div_euclid(86_400));
    const M: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    format!("{}-{}-{}", d, M[(mo - 1) as usize], y)
}

/// Days since 1970-01-01 → (year, month, day). Howard Hinnant's algorithm.
fn civil(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d)
}

const SENT_NAMES: &[&str] = &["Sent", "Sent Messages", "Sendt", "Sendte elementer", "Sendte e-mails", "Sent Items", "[Gmail]/Sent Mail", "[Gmail]/Sendte e-mails", "INBOX.Sent", "INBOX.Sent Messages", "INBOX.Sendt"];

fn fetch_blocking(a: Account, folder: String, since_uid: u32, uid_validity: u32, days: u32, max: u32) -> Result<Fetched, String> {
    let mut s = connect(&a)?;
    // "SENT" means: whatever this server calls its Sent folder.
    let folder = if folder == "SENT" { special(&mut s, "sent", SENT_NAMES).ok_or("Fandt ingen Sendt-mappe på serveren")? } else { folder };
    let mb = s.select(&folder).map_err(err("Mappe"))?;
    let validity = mb.uid_validity.unwrap_or(0);
    // A changed UIDVALIDITY means the server renumbered everything: start over.
    let since = if validity != uid_validity { 0 } else { since_uid };
    let mut uids: Vec<u32> = if since == 0 {
        s.uid_search(format!("SINCE {}", imap_date(days))).map_err(err("Søgning"))?.into_iter().collect()
    } else {
        s.uid_search(format!("UID {}:*", since + 1)).map_err(err("Søgning"))?.into_iter().filter(|u| *u > since).collect()
    };
    uids.sort_unstable();
    if uids.len() > max as usize { uids = uids.split_off(uids.len() - max as usize); }
    let mut messages = Vec::with_capacity(uids.len());
    for chunk in uids.chunks(25) {
        let set = chunk.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        let fetched = s.uid_fetch(&set, "(UID FLAGS BODY.PEEK[])").map_err(err("Hentning"))?;
        for f in fetched.iter() {
            if let (Some(uid), Some(body)) = (f.uid, f.body()) {
                if let Some(m) = parse(uid, body, f.flags()) { messages.push(m); }
            }
        }
    }
    let _ = s.logout();
    Ok(Fetched { folder, uid_validity: validity, messages, exists: mb.exists })
}

const TRASH_NAMES: &[&str] = &["Trash", "Papirkurv", "Deleted Messages", "Deleted Items", "Deleted", "Slettet post", "Slettede elementer", "[Gmail]/Trash", "[Gmail]/Papirkurv",
    "INBOX.Trash", "INBOX.Papirkurv", "INBOX.Deleted Messages", "INBOX.Deleted Items"];

/// Like `special`, but makes the folder when the server has none (some small hosts start without Trash/Archive).
/// The new folder follows the server's own naming (INBOX.Trash where folders live under INBOX).
fn special_or_create(s: &mut Session, flag: &str, names: &[&str], make: &str) -> Option<String> {
    if let Some(f) = special(s, flag, names) { return Some(f); }
    let under_inbox = s.list(Some(""), Some("*")).ok().map(|l| l.iter().any(|n| n.name().starts_with("INBOX.") || n.name().starts_with("INBOX/"))).unwrap_or(false);
    let sep = s.list(Some(""), Some("INBOX")).ok().and_then(|l| l.iter().next().and_then(|n| n.delimiter().map(|d| d.to_string()))).unwrap_or_else(|| ".".into());
    let name = if under_inbox { format!("INBOX{sep}{make}") } else { make.to_string() };
    s.create(&name).ok()?;
    let _ = s.subscribe(&name);
    Some(name)
}

/// Finds a folder by its special-use flag (\Archive, \Trash, \Sent), with common names as fallback.
fn special(s: &mut Session, flag: &str, names: &[&str]) -> Option<String> {
    let list = s.list(Some(""), Some("*")).ok()?;
    for n in list.iter() {
        if n.attributes().iter().any(|a| format!("{a:?}").to_lowercase().contains(&flag.to_lowercase())) {
            return Some(n.name().to_string());
        }
    }
    for want in names {
        for n in list.iter() {
            if n.name().eq_ignore_ascii_case(want) { return Some(n.name().to_string()); }
        }
    }
    None
}

#[tauri::command]
pub async fn mail_test(account: Account) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = connect(&account).map_err(friendly)?;
        let mb = s.select("INBOX").map_err(err("Indbakke"))?;
        let _ = s.logout();
        Ok(mb.exists)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mail_fetch(account: Account, folder: Option<String>, since_uid: u32, uid_validity: u32, days: Option<u32>, max: Option<u32>) -> Result<Fetched, String> {
    let folder = folder.unwrap_or_else(|| "INBOX".into());
    tauri::async_runtime::spawn_blocking(move || fetch_blocking(account, folder, since_uid, uid_validity, days.unwrap_or(30), max.unwrap_or(300)).map_err(friendly))
        .await
        .map_err(|e| e.to_string())?
}

/// Marks read/unread, or moves to Archive / Trash on the server.
#[tauri::command]
pub async fn mail_update(account: Account, uids: Vec<u32>, seen: Option<bool>, flagged: Option<bool>, action: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if uids.is_empty() { return Ok(()); }
        let mut s = connect(&account).map_err(friendly)?;
        s.select("INBOX").map_err(err("Indbakke"))?;
        let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        if let Some(v) = seen { s.uid_store(&set, if v { "+FLAGS (\\Seen)" } else { "-FLAGS (\\Seen)" }).map_err(err("Flag"))?; }
        if let Some(v) = flagged { s.uid_store(&set, if v { "+FLAGS (\\Flagged)" } else { "-FLAGS (\\Flagged)" }).map_err(err("Flag"))?; }
        match action.as_deref() {
            Some("archive") => {
                let to = special_or_create(&mut s, "archive", &["Archive", "Arkiv", "[Gmail]/All Mail", "[Gmail]/Alle e-mails", "Archived", "INBOX.Archive", "INBOX.Arkiv"], "Archive").ok_or("Fandt ingen arkiv-mappe på serveren, og kunne ikke lave en")?;
                s.uid_mv(&set, &to).or_else(|_| s.uid_copy(&set, &to).and_then(|_| s.uid_store(&set, "+FLAGS (\\Deleted)")).and_then(|_| s.expunge().map(|_| ()))).map_err(err("Arkivér"))?;
            }
            Some("trash") => {
                let to = special_or_create(&mut s, "trash", TRASH_NAMES, "Trash").ok_or("Fandt ingen papirkurv på serveren, og kunne ikke lave en")?;
                s.uid_mv(&set, &to).or_else(|_| s.uid_copy(&set, &to).and_then(|_| s.uid_store(&set, "+FLAGS (\\Deleted)")).and_then(|_| s.expunge().map(|_| ()))).map_err(err("Slet"))?;
            }
            _ => {}
        }
        let _ = s.logout();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
pub struct Outgoing {
    pub to: Vec<String>,
    pub cc: Option<Vec<String>>,
    pub subject: String,
    pub body: String,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct Sent {
    pub from: String,
    pub message_id: String,
    /// Where a copy was saved ("" when the server does it itself, like Gmail, or saving failed).
    pub saved_in: String,
}

/// Gmail and iCloud put what you send through SMTP into Sent themselves; elsewhere CENTRA saves a copy.
fn saves_sent_itself(a: &Account) -> bool {
    let h = format!("{} {}", a.host, a.smtp_host).to_lowercase();
    h.contains("gmail") || h.contains("googlemail") || h.contains("mail.me.com")
}

#[tauri::command]
pub async fn mail_send(account: Account, mail: Outgoing) -> Result<Sent, String> {
    use lettre::message::{header::ContentType, Mailbox};
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::transport::smtp::client::{Tls, TlsParameters};
    use lettre::{Message, SmtpTransport, Transport};
    tauri::async_runtime::spawn_blocking(move || {
        let from_email = account.from_email.clone().unwrap_or_else(|| account.user.clone());
        let from: Mailbox = format!("{} <{}>", account.from_name.clone().unwrap_or_default(), from_email).trim().parse().or_else(|_| from_email.parse()).map_err(err("Afsender"))?;
        let mut b = Message::builder().from(from).subject(mail.subject.clone()).header(ContentType::TEXT_PLAIN).message_id(None);
        for t in &mail.to { b = b.to(t.parse().map_err(err("Modtager"))?); }
        for t in mail.cc.iter().flatten() { b = b.cc(t.parse().map_err(err("Cc"))?); }
        if let Some(r) = mail.in_reply_to.as_ref().filter(|x| !x.is_empty()) { b = b.in_reply_to(format!("<{}>", r.trim_matches(|c| c == '<' || c == '>'))); }
        if let Some(r) = mail.references.as_ref().filter(|x| !x.is_empty()) { b = b.references(r.split_whitespace().map(|x| format!("<{}>", x.trim_matches(|c| c == '<' || c == '>'))).collect::<Vec<_>>().join(" ")); }
        let msg = b.body(mail.body.clone()).map_err(err("Besked"))?;
        let creds = Credentials::new(account.user.clone(), account.pass.clone());
        let params = TlsParameters::new(account.smtp_host.clone()).map_err(err("TLS"))?;
        let tls = match account.smtp_security.as_str() {
            "tls" => Tls::Wrapper(params),
            "starttls" => Tls::Required(params),
            "none" if local(&account.smtp_host) => Tls::None,
            _ => return Err("Ukrypteret afsendelse er ikke tilladt".into()),
        };
        let t = SmtpTransport::builder_dangerous(&account.smtp_host).port(account.smtp_port).tls(tls).credentials(creds).timeout(Some(Duration::from_secs(30))).build();
        t.send(&msg).map_err(|e| friendly(format!("Afsendelse: {e}")))?;
        let message_id = msg.headers().get_raw("Message-ID").unwrap_or("").trim().trim_matches(|c| c == '<' || c == '>').to_string();
        // A copy in Sent, so it shows up there in CENTRA and in every other mail app. Never fails the send.
        let mut saved_in = String::new();
        if !saves_sent_itself(&account) {
            if let Ok(mut s) = connect(&account) {
                if let Some(folder) = special(&mut s, "sent", SENT_NAMES) {
                    if s.append_with_flags(&folder, msg.formatted(), &[imap::types::Flag::Seen]).is_ok() { saved_in = folder; }
                }
                let _ = s.logout();
            }
        }
        Ok(Sent { from: from_email, message_id, saved_in })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Downloads a calendar feed (iCal). https only (webcal:// is rewritten), at most 8 MB.
#[tauri::command]
pub async fn fetch_calendar(url: String) -> Result<String, String> {
    let url = url.trim().replacen("webcal://", "https://", 1);
    if !url.starts_with("https://") { return Err("Adressen skal starte med https:// eller webcal://".into()); }
    let r = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().map_err(err("HTTP"))?
        .get(&url).header("user-agent", "CENTRA").send().await.map_err(|e| friendly(format!("Kalender: {e}")))?;
    if !r.status().is_success() { return Err(format!("Kalenderen svarede {}", r.status())); }
    let bytes = r.bytes().await.map_err(err("Kalender"))?;
    if bytes.len() > 8 * 1024 * 1024 { return Err("Kalenderen er for stor".into()); }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_753), (2026, 10, 27));
    }
    #[test]
    fn html() {
        let t = strip_html("<html><head><style>p{}</style></head><body><p>Hej&nbsp;Willads</p><script>x()</script><div>Vagtplan for uge 45</div></body></html>");
        assert_eq!(t, "Hej Willads\n\nVagtplan for uge 45");
    }
    #[test]
    fn parses() {
        let raw = b"From: Netto <vagt@netto.dk>\r\nTo: w@example.dk\r\nSubject: =?utf-8?q?Vagtplan_uge_45?=\r\nDate: Mon, 26 Oct 2026 10:00:00 +0100\r\nMessage-ID: <a1@netto.dk>\r\nList-Unsubscribe: <mailto:x>\r\n\r\nHej\r\nHer er din plan.\r\n";
        let m = parse(7, raw, &[imap::types::Flag::Seen]).unwrap();
        assert_eq!((m.from_name.as_str(), m.from_email.as_str(), m.subject.as_str()), ("Netto", "vagt@netto.dk", "Vagtplan uge 45"));
        assert!(m.seen && m.list && m.text.contains("Her er din plan"));
        assert_eq!(m.message_id, "a1@netto.dk");
    }

    #[test]
    fn html_and_parts() {
        let raw = b"From: Mads <mads@example.dk>\r\nTo: w@example.dk\r\nSubject: Billeder\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=X\r\n\r\n--X\r\nContent-Type: multipart/related; boundary=Y\r\n\r\n--Y\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Se <b>her</b>: <img src=\"cid:logo@x\"></p>\r\n--Y\r\nContent-Type: image/png\r\nContent-ID: <logo@x>\r\nContent-Disposition: inline\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n--Y--\r\n--X\r\nContent-Type: application/pdf; name=\"Kontrakt.pdf\"\r\nContent-Disposition: attachment; filename=\"Kontrakt.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQ=\r\n--X--\r\n";
        let m = parse(9, raw, &[]).unwrap();
        assert!(m.html.contains("<b>her</b>") && m.html.contains("cid:logo@x"), "{}", m.html);
        assert!(m.text.contains("Se her"));
        let p: Vec<_> = m.parts.iter().map(|p| (p.index, p.name.as_str(), p.mime.as_str(), p.cid.as_str(), p.inline, p.size)).collect();
        assert_eq!(p, vec![(0, "billede", "image/png", "logo@x", true, 8), (1, "Kontrakt.pdf", "application/pdf", "", false, 8)]);
        let parsed = MessageParser::default().parse(&raw[..]).unwrap();
        assert_eq!(parsed.attachment(1).unwrap().contents(), b"%PDF-1.4");
        assert_eq!(safe_name("../../.ssh/id_rsa"), "_.._.ssh_id_rsa");
        assert_eq!(safe_name(".hidden"), "hidden");
    }

    /// Against a real IMAP/SMTP server on this machine: CENTRA_MAIL_TEST=1 cargo test --lib live -- --nocapture
    #[test]
    fn live() {
        if std::env::var("CENTRA_MAIL_TEST").is_err() { return; }
        let a = Account { host: "127.0.0.1".into(), port: 1143, security: "none".into(), user: "willads@test.dk".into(), pass: "hemmelig-app-kode".into(),
            smtp_host: "127.0.0.1".into(), smtp_port: 1025, smtp_security: "none".into(), from_name: Some("Willads Tranberg".into()), from_email: None };
        let rt = tauri::async_runtime::block_on(async {
            let n = mail_test(a.clone()).await.unwrap();
            let bad = mail_test(Account { pass: "forkert".into(), ..a.clone() }).await.unwrap_err();
            let f = mail_fetch(a.clone(), None, 0, 0, Some(30), Some(100)).await.unwrap();
            let again = mail_fetch(a.clone(), None, f.messages.iter().map(|m| m.uid).max().unwrap(), f.uid_validity, None, None).await.unwrap();
            let first = f.messages.iter().map(|m| m.uid).min().unwrap();
            mail_update(a.clone(), vec![first], Some(true), None, Some("archive".into())).await.unwrap();
            let after = mail_fetch(a.clone(), None, 0, 0, Some(30), Some(100)).await.unwrap();
            let sent = mail_send(a.clone(), Outgoing { to: vec!["sofie@example.dk".into()], cc: None, subject: "Re: Frokost på lørdag?".into(), body: "Ja, gerne! Ses kl. 12.".into(), in_reply_to: Some("s1@example.dk".into()), references: Some("<s1@example.dk>".into()) }).await;
            let box_ = mail_fetch(a.clone(), Some("SENT".into()), 0, 0, Some(30), Some(100)).await.unwrap();
            // Delete, also on a server that has no Trash folder yet (it gets made).
            let last = after.messages.iter().map(|m| m.uid).max().unwrap();
            mail_update(a.clone(), vec![last], Some(true), None, Some("trash".into())).await.unwrap();
            let left = mail_fetch(a.clone(), None, 0, 0, Some(30), Some(100)).await.unwrap();
            let trash = mail_fetch(a.clone(), Some("Trash".into()), 0, 0, Some(30), Some(100)).await.unwrap();
            assert_eq!(left.messages.len(), after.messages.len() - 1);
            assert!(!left.messages.iter().any(|m| m.uid == last));
            assert_eq!(trash.messages.len(), 1);
            (n, bad, f, again, after, sent, box_)
        });
        let (n, bad, f, again, after, sent, box_) = rt;
        println!("sent folder={} {:?}", box_.folder, box_.messages.iter().map(|m| (&m.subject, &m.message_id, &m.to)).collect::<Vec<_>>());
        let s = sent.as_ref().unwrap();
        assert_eq!(s.saved_in, "Sent");
        assert_eq!(box_.folder, "Sent");
        assert!(box_.messages.iter().any(|m| m.message_id == s.message_id && m.to == vec!["sofie@example.dk".to_string()] && m.seen));
        println!("exists={n} bad={bad}");
        for m in &f.messages { println!("{} | {} <{}> | {} | seen={} list={} | {:?}", m.uid, m.from_name, m.from_email, m.subject, m.seen, m.list, &m.text.chars().take(70).collect::<String>()); }
        println!("incremental={} after_archive={} sent={sent:?}", again.messages.len(), after.messages.len());
        assert_eq!(f.messages.len(), n as usize);
        assert!(bad.starts_with("Login blev afvist"));
        assert_eq!(again.messages.len(), 0);
        assert_eq!(after.messages.len(), f.messages.len() - 1);
        assert!(sent.is_ok());
    }
}
