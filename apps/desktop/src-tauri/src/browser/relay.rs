//! The browser's VPN: a small SOCKS5 server on 127.0.0.1 that the browser window uses as its proxy,
//! and that sends every connection on through your VPN provider's server (SOCKS5 or HTTP CONNECT,
//! with username and password). WebKit can't log in to a proxy itself, so this does it.
//!
//! - Host names go to the VPN server unresolved, so DNS lookups don't leak past the VPN.
//! - If the VPN server can't be reached or refuses the login, the connection fails. Nothing ever
//!   falls back to going out directly (no leaks when the VPN is down).
//! - Only CONNECT (TCP), only on 127.0.0.1; nothing else on the Mac or network can use it.

use base64::Engine;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio::time::timeout;

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Vpn {
    #[serde(default)]
    pub id: String,
    /// "wireguard", "socks5" or "http"
    pub kind: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    /// The WireGuard configuration file's text (kind "wireguard").
    #[serde(default)]
    pub conf: Option<String>,
    pub user: Option<String>,
    pub pass: Option<String>,
    #[serde(default)]
    pub name: String,
}

/// Where the browser wants to go.
#[derive(Clone, Debug)]
pub enum Host {
    Domain(String),
    V4([u8; 4]),
    V6([u8; 16]),
}
#[derive(Clone, Debug)]
pub struct Target {
    pub host: Host,
    pub port: u16,
}

impl Target {
    fn authority(&self) -> String {
        match &self.host {
            Host::Domain(d) => format!("{d}:{}", self.port),
            Host::V4(a) => format!("{}:{}", std::net::Ipv4Addr::from(*a), self.port),
            Host::V6(a) => format!("[{}]:{}", std::net::Ipv6Addr::from(*a), self.port),
        }
    }
}

pub type OnError = Arc<dyn Fn(String) + Send + Sync>;

pub struct Relay {
    pub port: u16,
    pub vpn: Vpn,
    task: JoinHandle<()>,
    _wg: Option<Arc<super::wg::Wg>>,
}
impl Drop for Relay {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Starts the local proxy for this VPN server. Stops when the returned Relay is dropped.
pub async fn start(vpn: Vpn, on_err: OnError) -> std::io::Result<Relay> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let wg = if vpn.kind == "wireguard" {
        let conf = super::wg::parse(vpn.conf.as_deref().unwrap_or("")).map_err(std::io::Error::other)?;
        Some(Arc::new(super::wg::Wg::start(conf).await.map_err(std::io::Error::other)?))
    } else { None };
    let up = Arc::new(vpn.clone());
    let wg2 = wg.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((client, _)) = listener.accept().await else { continue };
            let up = up.clone();
            let on_err = on_err.clone();
            let wg = wg2.clone();
            tokio::spawn(async move {
                let r = match wg { Some(wg) => serve_wg(client, &wg).await, None => serve(client, &up).await };
                if let Err(e) = r { on_err(e); }
            });
        }
    });
    Ok(Relay { port, vpn, task, _wg: wg })
}

async fn serve(mut c: TcpStream, up: &Vpn) -> Result<(), String> {
    let _ = c.set_nodelay(true);
    let target = timeout(Duration::from_secs(10), accept_socks(&mut c)).await.map_err(|_| String::new())?.map_err(|_| String::new())?;
    match connect(up, &target).await {
        Ok(mut u) => {
            c.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await.map_err(|_| String::new())?;
            let _ = tokio::io::copy_bidirectional(&mut c, &mut u).await;
            Ok(())
        }
        Err(e) => {
            let _ = c.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).await;
            Err(e)
        }
    }
}

async fn serve_wg(mut c: TcpStream, wg: &super::wg::Wg) -> Result<(), String> {
    let _ = c.set_nodelay(true);
    let target = timeout(Duration::from_secs(10), accept_socks(&mut c)).await.map_err(|_| String::new())?.map_err(|_| String::new())?;
    match wg.connect(target).await {
        Ok(conn) => {
            c.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await.map_err(|_| String::new())?;
            super::wg::bridge(c, conn).await;
            Ok(())
        }
        Err(e) => {
            let _ = c.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).await;
            // A site that doesn't exist isn't a VPN problem.
            if e.starts_with("Navnet") || e.starts_with("Siden") { Err(String::new()) } else { Err(e) }
        }
    }
}

/// The browser's side: SOCKS5 without login (it's only reachable from this Mac), CONNECT only.
async fn accept_socks(c: &mut TcpStream) -> std::io::Result<Target> {
    let bad = || std::io::Error::new(std::io::ErrorKind::InvalidData, "socks");
    let mut h = [0u8; 2];
    c.read_exact(&mut h).await?;
    if h[0] != 5 { return Err(bad()); }
    let mut methods = vec![0u8; h[1] as usize];
    c.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        c.write_all(&[5, 0xFF]).await?;
        return Err(bad());
    }
    c.write_all(&[5, 0]).await?;
    let mut r = [0u8; 4];
    c.read_exact(&mut r).await?;
    if r[0] != 5 || r[1] != 1 {
        c.write_all(&[5, 7, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
        return Err(bad());
    }
    let host = read_host(c, r[3]).await?;
    let mut p = [0u8; 2];
    c.read_exact(&mut p).await?;
    Ok(Target { host, port: u16::from_be_bytes(p) })
}

async fn read_host(c: &mut TcpStream, atyp: u8) -> std::io::Result<Host> {
    match atyp {
        1 => { let mut a = [0u8; 4]; c.read_exact(&mut a).await?; Ok(Host::V4(a)) }
        4 => { let mut a = [0u8; 16]; c.read_exact(&mut a).await?; Ok(Host::V6(a)) }
        3 => {
            let mut n = [0u8; 1];
            c.read_exact(&mut n).await?;
            let mut d = vec![0u8; n[0] as usize];
            c.read_exact(&mut d).await?;
            Ok(Host::Domain(String::from_utf8_lossy(&d).into_owned()))
        }
        _ => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "atyp")),
    }
}

/// Opens a connection to `t` through the VPN server.
pub async fn connect(up: &Vpn, t: &Target) -> Result<TcpStream, String> {
    timeout(Duration::from_secs(20), async {
        let mut s = TcpStream::connect((up.host.as_str(), up.port)).await.map_err(|e| format!("Kunne ikke nå VPN-serveren {} ({e})", up.host))?;
        let _ = s.set_nodelay(true);
        match up.kind.as_str() {
            "http" => http_connect(&mut s, up, t).await?,
            _ => socks5_connect(&mut s, up, t).await?,
        }
        Ok(s)
    })
    .await
    .map_err(|_| format!("VPN-serveren {} svarer ikke", up.host))?
}

async fn socks5_connect(s: &mut TcpStream, up: &Vpn, t: &Target) -> Result<(), String> {
    let io = |e: std::io::Error| format!("Forbindelsen til VPN-serveren blev afbrudt ({e})");
    let login = up.user.as_deref().filter(|u| !u.is_empty());
    s.write_all(if login.is_some() { &[5, 2, 0, 2] } else { &[5, 1, 0] }).await.map_err(io)?;
    let mut m = [0u8; 2];
    s.read_exact(&mut m).await.map_err(io)?;
    if m[0] != 5 { return Err("VPN-serveren er ikke en SOCKS5-server. Prøv typen HTTP.".into()); }
    match m[1] {
        0 => {}
        2 => {
            let (u, p) = (login.unwrap_or(""), up.pass.as_deref().unwrap_or(""));
            if u.len() > 255 || p.len() > 255 { return Err("Brugernavn eller adgangskode er for langt".into()); }
            let mut a = vec![1, u.len() as u8];
            a.extend_from_slice(u.as_bytes());
            a.push(p.len() as u8);
            a.extend_from_slice(p.as_bytes());
            s.write_all(&a).await.map_err(io)?;
            let mut r = [0u8; 2];
            s.read_exact(&mut r).await.map_err(io)?;
            if r[1] != 0 { return Err("VPN-serveren afviste brugernavn eller adgangskode".into()); }
        }
        0xFF => return Err(if login.is_some() { "VPN-serveren afviste login-metoden".into() } else { "VPN-serveren kræver brugernavn og adgangskode".into() }),
        _ => return Err("VPN-serveren bad om en login-metode, CENTRA ikke kender".into()),
    }
    let mut req = vec![5, 1, 0];
    match &t.host {
        Host::Domain(d) => { req.push(3); req.push(d.len().min(255) as u8); req.extend_from_slice(&d.as_bytes()[..d.len().min(255)]); }
        Host::V4(a) => { req.push(1); req.extend_from_slice(a); }
        Host::V6(a) => { req.push(4); req.extend_from_slice(a); }
    }
    req.extend_from_slice(&t.port.to_be_bytes());
    s.write_all(&req).await.map_err(io)?;
    let mut r = [0u8; 4];
    s.read_exact(&mut r).await.map_err(io)?;
    if r[1] != 0 {
        return Err(match r[1] {
            2 => "VPN-serveren tillod ikke forbindelsen".into(),
            3 | 4 => format!("{} kunne ikke nås gennem VPN'en", t.authority()),
            5 => format!("{} afviste forbindelsen", t.authority()),
            _ => format!("VPN-serveren kunne ikke åbne {} (kode {})", t.authority(), r[1]),
        });
    }
    // The address the server bound to: read and ignore.
    let skip = match r[3] { 1 => 4, 4 => 16, 3 => { let mut n = [0u8; 1]; s.read_exact(&mut n).await.map_err(io)?; n[0] as usize } _ => 0 };
    let mut rest = vec![0u8; skip + 2];
    s.read_exact(&mut rest).await.map_err(io)?;
    Ok(())
}

async fn http_connect(s: &mut TcpStream, up: &Vpn, t: &Target) -> Result<(), String> {
    let io = |e: std::io::Error| format!("Forbindelsen til VPN-serveren blev afbrudt ({e})");
    let auth = t.authority();
    let mut req = format!("CONNECT {auth} HTTP/1.1\r\nHost: {auth}\r\n");
    if let Some(u) = up.user.as_deref().filter(|u| !u.is_empty()) {
        let b = base64::engine::general_purpose::STANDARD.encode(format!("{u}:{}", up.pass.as_deref().unwrap_or("")));
        req.push_str(&format!("Proxy-Authorization: Basic {b}\r\n"));
    }
    req.push_str("\r\n");
    s.write_all(req.as_bytes()).await.map_err(io)?;
    // Read the answer up to the blank line, one byte at a time so nothing of the tunnel is eaten.
    let mut head = Vec::with_capacity(256);
    let mut b = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 16 * 1024 { return Err("VPN-serveren svarede ikke som forventet".into()); }
        s.read_exact(&mut b).await.map_err(io)?;
        head.push(b[0]);
    }
    let line = String::from_utf8_lossy(&head);
    let code = line.split_whitespace().nth(1).unwrap_or("");
    match code {
        "200" => Ok(()),
        "407" => Err("VPN-serveren afviste brugernavn eller adgangskode".into()),
        "403" => Err("VPN-serveren tillod ikke forbindelsen".into()),
        _ => Err(format!("VPN-serveren svarede {}", line.lines().next().unwrap_or("").trim())),
    }
}

#[derive(serde::Serialize, Debug)]
pub struct Check {
    pub ip: String,
    pub country: String,
    pub city: String,
}

/// What the world sees through the VPN: the public IP and where it is (asks ip-api.com through the tunnel).
pub async fn check(up: &Vpn) -> Result<Check, String> {
    let t = Target { host: Host::Domain("ip-api.com".into()), port: 80 };
    if up.kind == "wireguard" {
        // Through a short-lived relay, the same way the browser goes.
        let relay = start(up.clone(), Arc::new(|_| {})).await.map_err(|e| e.to_string())?;
        let mut s = TcpStream::connect(("127.0.0.1", relay.port)).await.map_err(|e| e.to_string())?;
        s.write_all(&[5, 1, 0]).await.map_err(|e| e.to_string())?;
        let mut g = [0u8; 2];
        s.read_exact(&mut g).await.map_err(|e| e.to_string())?;
        let mut req = vec![5, 1, 0, 3, 10];
        req.extend_from_slice(b"ip-api.com");
        req.extend_from_slice(&80u16.to_be_bytes());
        s.write_all(&req).await.map_err(|e| e.to_string())?;
        let mut r = [0u8; 10];
        timeout(Duration::from_secs(30), s.read_exact(&mut r)).await.map_err(|_| "VPN-serveren svarer ikke. Tjek WireGuard-filen, eller prøv en anden server.".to_string())?.map_err(|e| e.to_string())?;
        if r[1] != 0 { return Err("VPN-serveren svarer ikke. Tjek WireGuard-filen, eller prøv en anden server.".into()); }
        return ask_ip(s).await;
    }
    let s = connect(up, &t).await?;
    ask_ip(s).await
}

async fn ask_ip(mut s: TcpStream) -> Result<Check, String> {
    let io = |e: std::io::Error| format!("Testen blev afbrudt ({e})");
    s.write_all(b"GET /json/?fields=status,query,country,city HTTP/1.1\r\nHost: ip-api.com\r\nUser-Agent: CENTRA\r\nConnection: close\r\n\r\n").await.map_err(io)?;
    let mut buf = Vec::new();
    timeout(Duration::from_secs(15), s.read_to_end(&mut buf)).await.map_err(|_| "Testen tog for lang tid".to_string())?.map_err(io)?;
    let text = String::from_utf8_lossy(&buf);
    let body = text.split("\r\n\r\n").nth(1).unwrap_or("");
    let start = body.find('{').ok_or("Uventet svar fra testen")?;
    let end = body.rfind('}').ok_or("Uventet svar fra testen")?;
    let v: serde_json::Value = serde_json::from_str(&body[start..=end]).map_err(|_| "Uventet svar fra testen".to_string())?;
    let g = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    Ok(Check { ip: g("query"), country: g("country"), city: g("city") })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// A server that echoes back what it gets.
    async fn echo() -> u16 {
        let l = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = l.accept().await.unwrap();
                tokio::spawn(async move { let (mut r, mut w) = s.split(); let _ = tokio::io::copy(&mut r, &mut w).await; });
            }
        });
        port
    }

    /// A VPN provider's SOCKS5 server that wants user "willads" / "hemmelig" and remembers what host it was asked for.
    async fn provider_socks(seen: Arc<Mutex<Vec<String>>>) -> u16 {
        let l = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = l.accept().await.unwrap();
                let seen = seen.clone();
                tokio::spawn(async move {
                    let mut h = [0u8; 2]; s.read_exact(&mut h).await.unwrap();
                    let mut m = vec![0u8; h[1] as usize]; s.read_exact(&mut m).await.unwrap();
                    if !m.contains(&2) { s.write_all(&[5, 0xFF]).await.unwrap(); return; }
                    s.write_all(&[5, 2]).await.unwrap();
                    let mut v = [0u8; 2]; s.read_exact(&mut v).await.unwrap();
                    let mut u = vec![0u8; v[1] as usize]; s.read_exact(&mut u).await.unwrap();
                    let mut pl = [0u8; 1]; s.read_exact(&mut pl).await.unwrap();
                    let mut p = vec![0u8; pl[0] as usize]; s.read_exact(&mut p).await.unwrap();
                    if u != b"willads" || p != b"hemmelig" { s.write_all(&[1, 1]).await.unwrap(); return; }
                    s.write_all(&[1, 0]).await.unwrap();
                    let mut r = [0u8; 4]; s.read_exact(&mut r).await.unwrap();
                    let host = match read_host(&mut s, r[3]).await.unwrap() { Host::Domain(d) => d, Host::V4(a) => std::net::Ipv4Addr::from(a).to_string(), Host::V6(_) => "v6".into() };
                    let mut pb = [0u8; 2]; s.read_exact(&mut pb).await.unwrap();
                    seen.lock().unwrap().push(host.clone());
                    let real = if host == "echo.test" { "127.0.0.1".to_string() } else { host };
                    match TcpStream::connect((real.as_str(), u16::from_be_bytes(pb))).await {
                        Ok(mut t) => { s.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0]).await.unwrap(); let _ = tokio::io::copy_bidirectional(&mut s, &mut t).await; }
                        Err(_) => { s.write_all(&[5, 4, 0, 1, 0, 0, 0, 0, 0, 0]).await.unwrap(); }
                    }
                });
            }
        });
        port
    }

    /// A VPN provider's HTTP proxy (CONNECT with Basic login).
    async fn provider_http() -> u16 {
        let l = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = l.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut head = Vec::new(); let mut b = [0u8; 1];
                    while !head.ends_with(b"\r\n\r\n") { s.read_exact(&mut b).await.unwrap(); head.push(b[0]); }
                    let h = String::from_utf8_lossy(&head).to_string();
                    let want = base64::engine::general_purpose::STANDARD.encode("willads:hemmelig");
                    if !h.contains(&format!("Proxy-Authorization: Basic {want}")) { s.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n").await.unwrap(); return; }
                    let auth = h.split_whitespace().nth(1).unwrap().replace("echo.test", "127.0.0.1");
                    let mut t = TcpStream::connect(auth.as_str()).await.unwrap();
                    s.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await.unwrap();
                    let _ = tokio::io::copy_bidirectional(&mut s, &mut t).await;
                });
            }
        });
        port
    }

    /// What the browser does: SOCKS5 to the local relay, CONNECT by host name, then talk.
    async fn browse(relay: u16, host: &str, port: u16, msg: &[u8]) -> Result<Vec<u8>, u8> {
        let mut c = TcpStream::connect(("127.0.0.1", relay)).await.unwrap();
        c.write_all(&[5, 1, 0]).await.unwrap();
        let mut g = [0u8; 2]; c.read_exact(&mut g).await.unwrap();
        assert_eq!(g, [5, 0]);
        let mut req = vec![5, 1, 0, 3, host.len() as u8];
        req.extend_from_slice(host.as_bytes());
        req.extend_from_slice(&port.to_be_bytes());
        c.write_all(&req).await.unwrap();
        let mut r = [0u8; 10]; c.read_exact(&mut r).await.unwrap();
        if r[1] != 0 { return Err(r[1]); }
        c.write_all(msg).await.unwrap();
        let mut out = vec![0u8; msg.len()];
        c.read_exact(&mut out).await.unwrap();
        Ok(out)
    }

    fn vpn(kind: &str, port: u16, pass: &str) -> Vpn {
        Vpn { id: String::new(), kind: kind.into(), host: "127.0.0.1".into(), port, conf: None, user: Some("willads".into()), pass: Some(pass.into()), name: "Test".into() }
    }

    #[tokio::test]
    async fn socks5_vpn_with_login_and_remote_dns() {
        let target = echo().await;
        let seen = Arc::new(Mutex::new(Vec::new()));
        let up = provider_socks(seen.clone()).await;
        let errors = Arc::new(Mutex::new(Vec::<String>::new()));
        let e2 = errors.clone();
        let relay = start(vpn("socks5", up, "hemmelig"), Arc::new(move |m| e2.lock().unwrap().push(m))).await.unwrap();
        assert_eq!(browse(relay.port, "echo.test", target, b"hej gennem vpn").await.unwrap(), b"hej gennem vpn");
        // the host name went to the VPN server unresolved (no DNS lookup on the Mac)
        assert_eq!(seen.lock().unwrap().as_slice(), ["echo.test"]);
        assert!(errors.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn wrong_password_fails_and_never_goes_direct() {
        let target = echo().await;
        let up = provider_socks(Arc::new(Mutex::new(Vec::new()))).await;
        let errors = Arc::new(Mutex::new(Vec::<String>::new()));
        let e2 = errors.clone();
        let relay = start(vpn("socks5", up, "forkert"), Arc::new(move |m| e2.lock().unwrap().push(m))).await.unwrap();
        assert_eq!(browse(relay.port, "127.0.0.1", target, b"x").await, Err(5));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(errors.lock().unwrap().as_slice(), ["VPN-serveren afviste brugernavn eller adgangskode"]);
    }

    #[tokio::test]
    async fn vpn_server_down_fails_closed() {
        let target = echo().await;
        let dead = { let l = TcpListener::bind(("127.0.0.1", 0)).await.unwrap(); l.local_addr().unwrap().port() }; // closed again
        let errors = Arc::new(Mutex::new(Vec::<String>::new()));
        let e2 = errors.clone();
        let relay = start(vpn("socks5", dead, "hemmelig"), Arc::new(move |m| e2.lock().unwrap().push(m))).await.unwrap();
        assert_eq!(browse(relay.port, "127.0.0.1", target, b"x").await, Err(5));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(errors.lock().unwrap()[0].starts_with("Kunne ikke nå VPN-serveren"));
    }

    #[tokio::test]
    async fn http_connect_vpn() {
        let target = echo().await;
        let up = provider_http().await;
        let relay = start(vpn("http", up, "hemmelig"), Arc::new(|_| {})).await.unwrap();
        assert_eq!(browse(relay.port, "echo.test", target, b"via http").await.unwrap(), b"via http");
        let bad = start(vpn("http", up, "nej"), Arc::new(|_| {})).await.unwrap();
        assert_eq!(browse(bad.port, "echo.test", target, b"x").await, Err(5));
        let err = connect(&vpn("http", up, "nej"), &Target { host: Host::Domain("echo.test".into()), port: target }).await.unwrap_err();
        assert_eq!(err, "VPN-serveren afviste brugernavn eller adgangskode");
    }

    #[tokio::test]
    async fn relay_stops_when_dropped() {
        let up = provider_socks(Arc::new(Mutex::new(Vec::new()))).await;
        let relay = start(vpn("socks5", up, "hemmelig"), Arc::new(|_| {})).await.unwrap();
        let port = relay.port;
        drop(relay);
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
    }
}
