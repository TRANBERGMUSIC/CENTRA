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
}

#[derive(Serialize)]
pub struct Fetched {
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

fn parse(uid: u32, raw: &[u8], flags: &[imap::types::Flag]) -> Option<Msg> {
    let m = MessageParser::default().parse(raw)?;
    let from = addr_list(m.from()).into_iter().next().unwrap_or_default();
    let mut text = m.body_text(0).map(|t| t.to_string()).unwrap_or_default();
    if text.trim().is_empty() {
        if let Some(h) = m.body_html(0) { text = strip_html(&h); }
    }
    if text.len() > 60_000 {
        let mut cut = 60_000;
        while !text.is_char_boundary(cut) { cut -= 1; }
        text.truncate(cut);
    }
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
    })
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

fn fetch_blocking(a: Account, folder: String, since_uid: u32, uid_validity: u32, days: u32, max: u32) -> Result<Fetched, String> {
    let mut s = connect(&a)?;
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
    Ok(Fetched { uid_validity: validity, messages, exists: mb.exists })
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
                let to = special(&mut s, "archive", &["Archive", "Arkiv", "[Gmail]/All Mail", "[Gmail]/Alle e-mails", "Archived"]).ok_or("Fandt ingen arkiv-mappe på serveren")?;
                s.uid_mv(&set, &to).or_else(|_| s.uid_copy(&set, &to).and_then(|_| s.uid_store(&set, "+FLAGS (\\Deleted)")).and_then(|_| s.expunge().map(|_| ()))).map_err(err("Arkivér"))?;
            }
            Some("trash") => {
                let to = special(&mut s, "trash", &["Trash", "Papirkurv", "Deleted Messages", "Slettet post", "[Gmail]/Trash", "[Gmail]/Papirkurv", "INBOX.Trash"]).ok_or("Fandt ingen papirkurv på serveren")?;
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

#[tauri::command]
pub async fn mail_send(account: Account, mail: Outgoing) -> Result<String, String> {
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
        Ok(from_email)
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
            (n, bad, f, again, after, sent)
        });
        let (n, bad, f, again, after, sent) = rt;
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
