//! A company's logo for its mails in the inbox (Google, Netflix, your bank …): the icon the company's
//! own website gives (apple-touch-icon, the icons its front page names, or favicon.ico).
//!
//! Only the company's own site is asked, with no cookies and nothing about you, and only for the
//! plain domain (google.com for accounts.google.com). Addresses on the local network, IP addresses and
//! odd names are refused, and so is a site that redirects somewhere like that. The interface shrinks
//! the picture and keeps it, so each domain is asked once in a long while.

use base64::Engine;
use serde::Serialize;
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

#[derive(Serialize)]
pub struct Logo {
    pub mime: String,
    /// base64
    pub data: String,
}

const MAX_IMAGE: usize = 400 * 1024;
const MAX_PAGE: usize = 768 * 1024;

fn valid_domain(d: &str) -> bool {
    d.len() <= 253
        && d.contains('.')
        && !d.starts_with('.')
        && !d.ends_with('.')
        && d.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        && d.parse::<IpAddr>().is_err()
        && !d.ends_with(".local")
        && !d.ends_with(".internal")
        && !d.ends_with(".lan")
        && !d.ends_with(".localhost")
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => !(v.is_private() || v.is_loopback() || v.is_link_local() || v.is_unspecified() || v.is_broadcast() || v.is_documentation() || v.octets()[0] == 100 && (64..128).contains(&v.octets()[1]) || v.octets()[0] >= 224),
        IpAddr::V6(v) => !(v.is_loopback() || v.is_unspecified() || v.is_multicast() || (v.segments()[0] & 0xfe00) == 0xfc00 || (v.segments()[0] & 0xffc0) == 0xfe80),
    }
}

/// The name must lead to the internet, not to something on your own network.
fn resolves_public(host: &str) -> bool {
    match (host, 443).to_socket_addrs() {
        Ok(addrs) => {
            let all: Vec<_> = addrs.collect();
            !all.is_empty() && all.iter().all(|a| public_ip(a.ip()))
        }
        Err(_) => false,
    }
}

fn host_ok(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| valid_domain(h) && resolves_public(h))
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() >= 4 || !host_ok(a.url()) { a.stop() } else { a.follow() }
        }))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")
        .build()
        .map_err(|e| e.to_string())
}

async fn get_limited(c: &reqwest::Client, url: &reqwest::Url, max: usize) -> Option<(String, Vec<u8>)> {
    let u = url.clone();
    if !tauri::async_runtime::spawn_blocking(move || host_ok(&u)).await.unwrap_or(false) {
        return None;
    }
    let mut res = c.get(url.clone()).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    if res.content_length().is_some_and(|n| n as usize > max) {
        return None;
    }
    let mime = res.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.ok()? {
        body.extend_from_slice(&chunk);
        if body.len() > max {
            return None;
        }
    }
    Some((mime, body))
}

/// What a picture is, from its first bytes (a site's content type isn't always right).
fn image_type(mime: &str, b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) { return Some("image/png"); }
    if b.starts_with(&[0xff, 0xd8, 0xff]) { return Some("image/jpeg"); }
    if b.starts_with(b"GIF8") { return Some("image/gif"); }
    if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" { return Some("image/webp"); }
    if b.starts_with(&[0, 0, 1, 0]) { return Some("image/x-icon"); }
    let head = String::from_utf8_lossy(&b[..b.len().min(512)]).to_ascii_lowercase();
    if (mime.contains("svg") || head.trim_start().starts_with("<?xml") || head.trim_start().starts_with("<svg")) && head.contains("<svg") { return Some("image/svg+xml"); }
    None
}

/// The icons a front page names: (url, how good it is).
fn icons_in(page: &str, base: &reqwest::Url) -> Vec<(reqwest::Url, u32)> {
    let lower = page.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = lower[at..].find("<link") {
        let start = at + i;
        let end = lower[start..].find('>').map(|e| start + e).unwrap_or(lower.len());
        let tag = &page[start..end];
        let tl = &lower[start..end];
        at = end;
        let attr = |name: &str| -> Option<String> {
            let k = tl.find(&format!("{name}="))?;
            let rest = &tag[k + name.len() + 1..];
            let q = rest.chars().next()?;
            if q == '"' || q == '\'' { rest[1..].split(q).next().map(|s| s.to_string()) } else { rest.split(|c: char| c.is_whitespace() || c == '>').next().map(|s| s.to_string()) }
        };
        let rel = attr("rel").unwrap_or_default().to_ascii_lowercase();
        if !rel.split_whitespace().any(|r| r == "icon" || r == "apple-touch-icon" || r == "apple-touch-icon-precomposed") { continue; }
        let Some(href) = attr("href") else { continue };
        let Ok(url) = base.join(href.trim()) else { continue };
        let size: u32 = attr("sizes").and_then(|s| s.split(['x', 'X']).next().and_then(|n| n.trim().parse().ok())).unwrap_or(0);
        let svg = href.to_ascii_lowercase().ends_with(".svg");
        let score = if rel.contains("apple-touch-icon") { 1000 + size } else if svg { 900 } else { size.min(512) + 100 };
        out.push((url, score));
    }
    out.sort_by(|a, b| b.1.cmp(&a.1));
    out
}

async fn find(domain: &str) -> Option<Logo> {
    let c = client().ok()?;
    let mut tried = std::collections::HashSet::new();
    let mut tries: Vec<reqwest::Url> = Vec::new();
    for host in [domain.to_string(), format!("www.{domain}")] {
        let base = reqwest::Url::parse(&format!("https://{host}/")).ok()?;
        if let Some((_, page)) = get_limited(&c, &base, MAX_PAGE).await {
            let text = String::from_utf8_lossy(&page);
            tries.extend(icons_in(&text, &base).into_iter().map(|x| x.0).take(4));
            tries.push(base.join("/apple-touch-icon.png").ok()?);
            tries.push(base.join("/favicon.ico").ok()?);
            break;
        }
    }
    if tries.is_empty() {
        let base = reqwest::Url::parse(&format!("https://{domain}/")).ok()?;
        tries.push(base.join("/apple-touch-icon.png").ok()?);
        tries.push(base.join("/favicon.ico").ok()?);
    }
    for url in tries.into_iter().take(7) {
        if !tried.insert(url.to_string()) { continue; }
        if let Some((mime, body)) = get_limited(&c, &url, MAX_IMAGE).await {
            if let Some(kind) = image_type(&mime, &body) {
                return Some(Logo { mime: kind.into(), data: base64::engine::general_purpose::STANDARD.encode(&body) });
            }
        }
    }
    None
}

/// The logo for a domain ("google.com"), or nothing when it has none (or can't be reached).
#[tauri::command]
pub async fn mail_logo(domain: String) -> Result<Option<Logo>, String> {
    let d = domain.trim().trim_end_matches('.').to_ascii_lowercase();
    if !valid_domain(&d) {
        return Ok(None);
    }
    Ok(tokio::time::timeout(Duration::from_secs(20), find(&d)).await.ok().flatten())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_odd_and_local_names() {
        assert!(valid_domain("google.com"));
        assert!(!valid_domain("localhost"));
        assert!(!valid_domain("192.168.1.10"));
        assert!(!valid_domain("printer.local"));
        assert!(!valid_domain("a b.com"));
        assert!(!public_ip("10.0.0.2".parse().unwrap()));
        assert!(!public_ip("127.0.0.1".parse().unwrap()));
        assert!(!public_ip("100.64.1.1".parse().unwrap()));
        assert!(public_ip("142.250.74.110".parse().unwrap()));
    }

    #[test]
    fn picks_the_best_icon_on_a_page() {
        let base = reqwest::Url::parse("https://example.com/").unwrap();
        let page = r#"<head><link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="https://cdn.example.com/touch.png" sizes="180x180"><link rel="stylesheet" href="/a.css"></head>"#;
        let icons = icons_in(page, &base);
        assert_eq!(icons[0].0.as_str(), "https://cdn.example.com/touch.png");
        assert_eq!(icons[1].0.as_str(), "https://example.com/favicon-32.png");
        assert_eq!(icons.len(), 2);
    }

    #[test]
    fn knows_pictures_by_their_bytes() {
        assert_eq!(image_type("", &[0x89, b'P', b'N', b'G', 0, 0]), Some("image/png"));
        assert_eq!(image_type("text/html", b"<html>"), None);
        assert_eq!(image_type("image/svg+xml", b"<svg xmlns='x'></svg>"), Some("image/svg+xml"));
        assert_eq!(image_type("", &[0, 0, 1, 0, 1]), Some("image/x-icon"));
    }
}
