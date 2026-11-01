//! WireGuard inside CENTRA, for the browser only. Works with any VPN that hands out a WireGuard
//! configuration file (Proton VPN, also the free plan, Mullvad, IVPN, Surfshark, Windscribe, your own
//! server …). No system VPN, no admin rights, no other app is affected.
//!
//! How: the WireGuard protocol (boringtun) talks UDP to the VPN server; a small TCP/IP stack
//! (smoltcp) runs on the tunnel's inside, as if CENTRA were a computer on the VPN's network.
//! The browser's local SOCKS5 proxy (relay.rs) asks this module for connections. Host names are
//! looked up with the VPN's own DNS server through the tunnel, so not even DNS goes outside it.

use super::relay::{Host, Target};
use boringtun::noise::{Tunn, TunnResult};
use boringtun::x25519::{PublicKey, StaticSecret};
use smoltcp::iface::{Config, Interface, SocketHandle, SocketSet};
use smoltcp::phy::{Device, DeviceCapabilities, Medium, RxToken, TxToken};
use smoltcp::socket::{dns, tcp};
use smoltcp::time::Instant as SInstant;
use smoltcp::wire::{DnsQueryType, HardwareAddress, IpAddress, IpCidr};
use std::collections::VecDeque;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::{mpsc, oneshot, Notify};
use tokio::task::JoinHandle;

/* ------------------------------------------------------------------ the configuration file */

#[derive(Clone, Debug, PartialEq)]
pub struct WgConf {
    pub private: [u8; 32],
    pub addresses: Vec<(IpAddr, u8)>,
    pub dns: Vec<IpAddr>,
    pub mtu: usize,
    pub peer_public: [u8; 32],
    pub psk: Option<[u8; 32]>,
    #[allow(dead_code)]
    pub endpoint: String,
    pub keepalive: Option<u16>,
}

fn key(v: &str, what: &str) -> Result<[u8; 32], String> {
    use base64::Engine;
    let b = base64::engine::general_purpose::STANDARD.decode(v.trim()).map_err(|_| format!("{what} er ikke en gyldig WireGuard-nøgle"))?;
    b.try_into().map_err(|_| format!("{what} har forkert længde"))
}

/// Reads a WireGuard configuration file (the kind wg-quick and every VPN provider uses).
pub fn parse(conf: &str) -> Result<WgConf, String> {
    let mut sec = String::new();
    let (mut private, mut peer_public, mut psk, mut endpoint, mut keepalive) = (None, None, None, None, None);
    let (mut addresses, mut dns, mut mtu) = (Vec::new(), Vec::new(), 1420usize);
    let mut peers = 0;
    for raw in conf.lines() {
        let line = raw.split(['#', ';']).next().unwrap_or("").trim();
        if line.is_empty() { continue; }
        if line.starts_with('[') { sec = line.trim_matches(['[', ']']).trim().to_ascii_lowercase(); if sec == "peer" { peers += 1; } continue; }
        let Some((k, v)) = line.split_once('=') else { continue };
        let (k, v) = (k.trim().to_ascii_lowercase(), v.trim());
        match (sec.as_str(), k.as_str()) {
            ("interface", "privatekey") => private = Some(key(v, "PrivateKey")?),
            ("interface", "address") => for a in v.split(',') {
                let a = a.trim();
                let (ip, len) = a.split_once('/').map(|(i, l)| (i, l.parse::<u8>().ok())).unwrap_or((a, None));
                let ip: IpAddr = ip.trim().parse().map_err(|_| format!("Address \"{a}\" kan ikke læses"))?;
                addresses.push((ip, len.unwrap_or(if ip.is_ipv4() { 32 } else { 128 })));
            },
            ("interface", "dns") => for d in v.split(',') { if let Ok(ip) = d.trim().parse::<IpAddr>() { dns.push(ip); } },
            ("interface", "mtu") => mtu = v.parse().unwrap_or(1420).clamp(576, 1500),
            ("peer", "publickey") if peers == 1 => peer_public = Some(key(v, "PublicKey")?),
            ("peer", "presharedkey") if peers == 1 => psk = Some(key(v, "PresharedKey")?),
            ("peer", "endpoint") if peers == 1 => endpoint = Some(v.to_string()),
            ("peer", "persistentkeepalive") if peers == 1 => keepalive = v.parse().ok().filter(|k: &u16| *k > 0),
            _ => {}
        }
    }
    let private = private.ok_or("Filen mangler PrivateKey under [Interface]")?;
    let peer_public = peer_public.ok_or("Filen mangler PublicKey under [Peer]")?;
    let endpoint = endpoint.ok_or("Filen mangler Endpoint under [Peer]")?;
    if !addresses.iter().any(|(ip, _)| ip.is_ipv4()) { return Err("Filen mangler en IPv4-adresse under [Interface] → Address".into()); }
    if dns.is_empty() { dns.push("1.1.1.1".parse().unwrap()); }
    Ok(WgConf { private, addresses, dns, mtu, peer_public, psk, endpoint, keepalive: keepalive.or(Some(25)) })
}

/* ------------------------------------------------------------------ the tunnel's network card */

struct VDev {
    rx: VecDeque<Vec<u8>>,
    tx: VecDeque<Vec<u8>>,
    mtu: usize,
}
struct VRx(Vec<u8>);
struct VTx<'a>(&'a mut VecDeque<Vec<u8>>);
impl RxToken for VRx {
    fn consume<R, F: FnOnce(&[u8]) -> R>(self, f: F) -> R { f(&self.0) }
}
impl TxToken for VTx<'_> {
    fn consume<R, F: FnOnce(&mut [u8]) -> R>(self, len: usize, f: F) -> R {
        let mut b = vec![0u8; len];
        let r = f(&mut b);
        self.0.push_back(b);
        r
    }
}
impl Device for VDev {
    type RxToken<'a> = VRx where Self: 'a;
    type TxToken<'a> = VTx<'a> where Self: 'a;
    fn receive(&mut self, _: SInstant) -> Option<(Self::RxToken<'_>, Self::TxToken<'_>)> {
        let p = self.rx.pop_front()?;
        Some((VRx(p), VTx(&mut self.tx)))
    }
    fn transmit(&mut self, _: SInstant) -> Option<Self::TxToken<'_>> { Some(VTx(&mut self.tx)) }
    fn capabilities(&self) -> DeviceCapabilities {
        let mut c = DeviceCapabilities::default();
        c.medium = Medium::Ip;
        c.max_transmission_unit = self.mtu;
        c
    }
}

/* ------------------------------------------------------------------ the tunnel */

/// One TCP connection through the tunnel, as seen from the browser's side.
pub struct Conn {
    pub to_remote: mpsc::Sender<Vec<u8>>,
    pub from_remote: mpsc::Receiver<Vec<u8>>,
    wake: Arc<Notify>,
}

enum Cmd {
    Connect { target: Target, reply: oneshot::Sender<Result<Conn, String>> },
}

pub struct Wg {
    cmd: mpsc::UnboundedSender<Cmd>,
    task: JoinHandle<()>,
    wake: Arc<Notify>,
    #[allow(dead_code)]
    pub endpoint: String,
}
impl Drop for Wg {
    fn drop(&mut self) { self.task.abort(); }
}

impl Wg {
    /// Starts the tunnel (the handshake happens with the first connection).
    pub async fn start(conf: WgConf) -> Result<Wg, String> {
        let server: SocketAddr = tokio::net::lookup_host(&conf.endpoint).await.map_err(|e| format!("VPN-serveren {} kunne ikke findes ({e})", conf.endpoint))?
            .next().ok_or_else(|| format!("VPN-serveren {} kunne ikke findes", conf.endpoint))?;
        let udp = UdpSocket::bind(if server.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" }).await.map_err(|e| e.to_string())?;
        udp.connect(server).await.map_err(|e| format!("Kunne ikke nå VPN-serveren ({e})"))?;
        let (tx, rx) = mpsc::unbounded_channel();
        let wake = Arc::new(Notify::new());
        let endpoint = conf.endpoint.clone();
        let task = tokio::spawn(run(conf, udp, server.ip(), rx, wake.clone()));
        Ok(Wg { cmd: tx, task, wake, endpoint })
    }

    /// A TCP connection to `target` through the VPN.
    pub async fn connect(&self, target: Target) -> Result<Conn, String> {
        let (reply, rx) = oneshot::channel();
        self.cmd.send(Cmd::Connect { target, reply }).map_err(|_| "VPN-forbindelsen er lukket".to_string())?;
        self.wake.notify_one();
        tokio::time::timeout(Duration::from_secs(25), rx).await
            .map_err(|_| "VPN-serveren svarer ikke. Tjek WireGuard-filen, eller prøv en anden server.".to_string())?
            .map_err(|_| "VPN-forbindelsen er lukket".to_string())?
    }
}

/// Moves bytes between the browser's TCP connection and a connection through the tunnel.
pub async fn bridge(mut client: TcpStream, conn: Conn) {
    let Conn { to_remote, mut from_remote, wake } = conn;
    let (mut r, mut w) = client.split();
    let up = async {
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            match r.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => { if to_remote.send(buf[..n].to_vec()).await.is_err() { break; } wake.notify_one(); }
            }
        }
        let _ = to_remote.send(Vec::new()).await; // empty = the browser closed its side
        wake.notify_one();
    };
    let down = async {
        while let Some(b) = from_remote.recv().await {
            wake.notify_one(); // room again: the tunnel can read more
            if w.write_all(&b).await.is_err() { break; }
        }
        let _ = w.shutdown().await;
    };
    tokio::join!(up, down);
}

enum Phase {
    Resolving(dns::QueryHandle),
    Connecting,
    Open,
}
struct Slot {
    phase: Phase,
    port: u16,
    tcp: Option<SocketHandle>,
    reply: Option<oneshot::Sender<Result<Conn, String>>>,
    from_browser: mpsc::Receiver<Vec<u8>>,
    to_browser: mpsc::Sender<Vec<u8>>,
    pending: Vec<u8>,
    browser_closed: bool,
    started: Instant,
    /// The browser's ends, handed over when the connection is open.
    conn: Option<Conn>,
}

async fn run(conf: WgConf, udp: UdpSocket, server_ip: IpAddr, mut cmds: mpsc::UnboundedReceiver<Cmd>, wake: Arc<Notify>) {
    let epoch = Instant::now();
    let now = || SInstant::from_millis(epoch.elapsed().as_millis() as i64);
    let mut tunn = Tunn::new(StaticSecret::from(conf.private), PublicKey::from(conf.peer_public), conf.psk, conf.keepalive, rand_index(), None);
    let mut dev = VDev { rx: VecDeque::new(), tx: VecDeque::new(), mtu: conf.mtu };
    let mut cfg = Config::new(HardwareAddress::Ip);
    cfg.random_seed = rand_index() as u64 ^ ((epoch.elapsed().as_nanos() as u64) << 17);
    let mut iface = Interface::new(cfg, &mut dev, now());
    iface.update_ip_addrs(|a| {
        for (ip, len) in &conf.addresses { let _ = a.push(IpCidr::new(IpAddress::from(*ip), *len)); }
    });
    for (ip, _) in &conf.addresses {
        match ip {
            IpAddr::V4(v4) => { let _ = iface.routes_mut().add_default_ipv4_route(*v4); }
            IpAddr::V6(v6) => { let _ = iface.routes_mut().add_default_ipv6_route(*v6); }
        }
    }
    let mut sockets = SocketSet::new(vec![]);
    let dns_servers: Vec<IpAddress> = conf.dns.iter().filter(|d| d.is_ipv4() || conf.addresses.iter().any(|(a, _)| a.is_ipv6())).map(|d| IpAddress::from(*d)).collect();
    let dns_handle = sockets.add(dns::Socket::new(&dns_servers, vec![]));
    let mut slots: Vec<Slot> = Vec::new();
    let mut next_port: u16 = 40000;
    let mut net_buf = vec![0u8; 65536];
    let mut out_buf = vec![0u8; conf.mtu + 200];
    let mut last_timers = Instant::now();

    // Sends whatever the tunnel says must go to the VPN server.
    async fn flush(udp: &UdpSocket, r: TunnResult<'_>) { if let TunnResult::WriteToNetwork(b) = r { let _ = udp.send(b).await; } }

    loop {
        // 1. Packets from the VPN server → into the tunnel's network card.
        loop {
            match udp.try_recv(&mut net_buf) {
                Ok(n) => {
                    let mut first = true;
                    loop {
                        let src: &[u8] = if first { &net_buf[..n] } else { &[] };
                        let res = tunn.decapsulate(Some(server_ip), src, &mut out_buf);
                        first = false;
                        match res {
                            TunnResult::WriteToNetwork(b) => { let _ = udp.send(b).await; continue; }
                            TunnResult::WriteToTunnelV4(p, _) | TunnResult::WriteToTunnelV6(p, _) => { dev.rx.push_back(p.to_vec()); }
                            _ => {}
                        }
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // 2. New connections from the browser.
        while let Ok(Cmd::Connect { target, reply }) = cmds.try_recv() {
            let (tb_tx, tb_rx) = mpsc::channel(64);
            let (fb_tx, fb_rx) = mpsc::channel(64);
            let conn = Conn { to_remote: fb_tx, from_remote: tb_rx, wake: wake.clone() };
            let mut slot = Slot { phase: Phase::Connecting, port: target.port, tcp: None, reply: Some(reply), from_browser: fb_rx, to_browser: tb_tx, pending: Vec::new(), browser_closed: false, started: Instant::now(), conn: Some(conn) };
            let addr = match &target.host {
                Host::V4(a) => Some(IpAddress::from(std::net::Ipv4Addr::from(*a))),
                Host::V6(a) => Some(IpAddress::from(std::net::Ipv6Addr::from(*a))),
                Host::Domain(d) => d.parse::<IpAddr>().ok().map(IpAddress::from),
            };
            match (addr, &target.host) {
                (Some(ip), _) => { slot.tcp = open_tcp(&mut iface, &mut sockets, ip, target.port, &mut next_port); }
                (None, Host::Domain(d)) => {
                    let s = sockets.get_mut::<dns::Socket>(dns_handle);
                    match s.start_query(iface.context(), d, DnsQueryType::A) {
                        Ok(q) => slot.phase = Phase::Resolving(q),
                        Err(_) => { if let Some(r) = slot.reply.take() { let _ = r.send(Err(format!("{d} er ikke et gyldigt navn"))); } continue; }
                    }
                }
                _ => {}
            }
            if slot.tcp.is_none() && !matches!(slot.phase, Phase::Resolving(_)) {
                if let Some(r) = slot.reply.take() { let _ = r.send(Err("Forbindelsen kunne ikke oprettes".into())); }
                continue;
            }
            slots.push(slot);
        }
        // 3. Let the stack work, then move data.
        iface.poll(now(), &mut dev, &mut sockets);
        for slot in slots.iter_mut() {
            if let Phase::Resolving(q) = slot.phase {
                let s = sockets.get_mut::<dns::Socket>(dns_handle);
                match s.get_query_result(q) {
                    Ok(ips) => match ips.first() {
                        Some(ip) => { slot.tcp = open_tcp(&mut iface, &mut sockets, *ip, slot.port, &mut next_port); slot.phase = Phase::Connecting; if slot.tcp.is_none() { fail(slot, "Forbindelsen kunne ikke oprettes"); } }
                        None => fail(slot, "Navnet findes ikke"),
                    },
                    Err(dns::GetQueryResultError::Pending) => {}
                    Err(_) => fail(slot, "Navnet kunne ikke slås op gennem VPN'en"),
                }
            }
            let Some(h) = slot.tcp else { continue };
            let sock = sockets.get_mut::<tcp::Socket>(h);
            match slot.phase {
                Phase::Connecting => {
                    if sock.state() == tcp::State::Established {
                        slot.phase = Phase::Open;
                        if let (Some(r), Some(c)) = (slot.reply.take(), slot.conn.take()) { let _ = r.send(Ok(c)); }
                    } else if matches!(sock.state(), tcp::State::Closed | tcp::State::TimeWait) {
                        fail(slot, "Siden afviste forbindelsen");
                    }
                }
                Phase::Open => {
                    // browser → remote
                    loop {
                        if slot.pending.is_empty() {
                            match slot.from_browser.try_recv() {
                                Ok(b) if b.is_empty() => { slot.browser_closed = true; sock.close(); break; }
                                Ok(b) => slot.pending = b,
                                Err(mpsc::error::TryRecvError::Empty) => break,
                                Err(_) => { slot.browser_closed = true; sock.close(); break; }
                            }
                        }
                        if !sock.can_send() { break; }
                        match sock.send_slice(&slot.pending) { Ok(n) => { slot.pending.drain(..n); } Err(_) => break }
                        if !slot.pending.is_empty() { break; }
                    }
                    // remote → browser
                    while sock.can_recv() {
                        let Ok(permit) = slot.to_browser.try_reserve() else { break };
                        let mut chunk = Vec::new();
                        let _ = sock.recv(|d| { chunk.extend_from_slice(d); (d.len(), ()) });
                        if chunk.is_empty() { break; }
                        permit.send(chunk);
                    }
                }
                Phase::Resolving(_) => {}
            }
        }
        // Tidy up finished connections, and ones that never got going.
        slots.retain_mut(|slot| {
            if slot.reply.is_some() && slot.started.elapsed() > Duration::from_secs(25) { fail(slot, "VPN-serveren svarer ikke"); }
            let done = match (slot.tcp, &slot.phase) {
                (_, Phase::Open) => {
                    let s = sockets.get::<tcp::Socket>(slot.tcp.unwrap());
                    // the site finished (and everything it sent has been passed on), or the connection broke
                    !s.is_active() || (!s.may_recv() && !s.can_recv())
                }
                _ => slot.reply.is_none(),
            };
            if done {
                if let Some(h) = slot.tcp {
                    let s = sockets.get_mut::<tcp::Socket>(h);
                    if s.is_active() { s.close(); }
                    sockets.remove(h);
                }
            }
            !done
        });
        iface.poll(now(), &mut dev, &mut sockets);
        // 4. Packets out of the tunnel's network card → encrypted to the VPN server.
        while let Some(p) = dev.tx.pop_front() {
            flush(&udp, tunn.encapsulate(&p, &mut out_buf)).await;
        }
        if last_timers.elapsed() >= Duration::from_millis(250) {
            last_timers = Instant::now();
            flush(&udp, tunn.update_timers(&mut out_buf)).await;
        }
        // 5. Wait for the next thing to happen.
        let delay = iface.poll_delay(now(), &sockets).map(|d| Duration::from_millis(d.total_millis())).unwrap_or(Duration::from_millis(250)).min(Duration::from_millis(250));
        tokio::select! {
            _ = udp.readable() => {}
            _ = wake.notified() => {}
            _ = tokio::time::sleep(delay) => {}
        }
    }
}

fn fail(slot: &mut Slot, msg: &str) {
    if let Some(r) = slot.reply.take() { let _ = r.send(Err(msg.to_string())); }
    slot.conn = None;
}

fn open_tcp(iface: &mut Interface, sockets: &mut SocketSet<'_>, ip: IpAddress, port: u16, next: &mut u16) -> Option<SocketHandle> {
    let mut s = tcp::Socket::new(tcp::SocketBuffer::new(vec![0; 512 * 1024]), tcp::SocketBuffer::new(vec![0; 256 * 1024]));
    s.set_nagle_enabled(false);
    *next = if *next >= 64000 { 40000 } else { *next + 1 };
    s.connect(iface.context(), (ip, port), *next).ok()?;
    Some(sockets.add(s))
}

fn rand_index() -> u32 {
    let mut b = [0u8; 4];
    let _ = getrandom_fill(&mut b);
    u32::from_le_bytes(b)
}
fn getrandom_fill(b: &mut [u8]) -> Result<(), ()> {
    use rand_core::RngCore;
    rand_core::OsRng.fill_bytes(b);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use smoltcp::socket::udp;

    #[test]
    fn reads_a_provider_file() {
        let conf = "# Proton VPN\n[Interface]\n# Key for CENTRA\nPrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\nAddress = 10.2.0.2/32, fd00::2/128\nDNS = 10.2.0.1\n\n[Peer]\n# NL-FREE#1\nPublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 185.107.56.1:51820\n";
        let c = parse(conf).unwrap();
        assert_eq!(c.addresses, vec![("10.2.0.2".parse().unwrap(), 32), ("fd00::2".parse().unwrap(), 128)]);
        assert_eq!(c.dns, vec!["10.2.0.1".parse::<IpAddr>().unwrap()]);
        assert_eq!(c.endpoint, "185.107.56.1:51820");
        assert_eq!(c.keepalive, Some(25));
        assert_eq!(parse("[Interface]\nAddress = 10.0.0.2/32\n").unwrap_err(), "Filen mangler PrivateKey under [Interface]");
        assert!(parse("[Interface]\nPrivateKey = ikke-base64\n").unwrap_err().contains("PrivateKey"));
    }

    /// A WireGuard server (as a VPN provider would run it) with a tiny network behind it:
    /// 10.0.0.1 answers DNS ("echo.test" → 10.0.0.1) and echoes everything sent to TCP port 7.
    async fn server(server_priv: [u8; 32], client_pub: [u8; 32]) -> (u16, Arc<std::sync::atomic::AtomicUsize>) {
        let udp = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = udp.local_addr().unwrap().port();
        let echoed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let e2 = echoed.clone();
        tokio::spawn(async move {
            let epoch = Instant::now();
            let now = || SInstant::from_millis(epoch.elapsed().as_millis() as i64);
            let mut tunn = Tunn::new(StaticSecret::from(server_priv), PublicKey::from(client_pub), None, None, 7, None);
            let mut dev = VDev { rx: VecDeque::new(), tx: VecDeque::new(), mtu: 1420 };
            let mut iface = Interface::new(Config::new(HardwareAddress::Ip), &mut dev, now());
            iface.update_ip_addrs(|a| { let _ = a.push(IpCidr::new(IpAddress::v4(10, 0, 0, 1), 24)); });
            let _ = iface.routes_mut().add_default_ipv4_route(std::net::Ipv4Addr::new(10, 0, 0, 1));
            let mut sockets = SocketSet::new(vec![]);
            let mut listeners: Vec<SocketHandle> = Vec::new();
            let listen = |sockets: &mut SocketSet<'static>| { let mut s = tcp::Socket::new(tcp::SocketBuffer::new(vec![0; 65536]), tcp::SocketBuffer::new(vec![0; 65536])); s.listen(7).unwrap(); sockets.add(s) };
            listeners.push(listen(&mut sockets));
            let mut d = udp::Socket::new(udp::PacketBuffer::new(vec![udp::PacketMetadata::EMPTY; 8], vec![0; 4096]), udp::PacketBuffer::new(vec![udp::PacketMetadata::EMPTY; 8], vec![0; 4096]));
            d.bind(53).unwrap();
            let dns_h = sockets.add(d);
            let mut buf = vec![0u8; 65536];
            let mut out = vec![0u8; 2000];
            let mut peer: Option<SocketAddr> = None;
            loop {
                while let Ok((n, from)) = udp.try_recv_from(&mut buf) {
                    peer = Some(from);
                    let mut first = true;
                    loop {
                        let src: &[u8] = if first { &buf[..n] } else { &[] };
                        first = false;
                        match tunn.decapsulate(Some(from.ip()), src, &mut out) {
                            TunnResult::WriteToNetwork(b) => { let _ = udp.send_to(b, from).await; continue; }
                            TunnResult::WriteToTunnelV4(p, _) | TunnResult::WriteToTunnelV6(p, _) => dev.rx.push_back(p.to_vec()),
                            _ => {}
                        }
                        break;
                    }
                }
                iface.poll(now(), &mut dev, &mut sockets);
                // DNS: answer A queries with 10.0.0.1
                let ds = sockets.get_mut::<udp::Socket>(dns_h);
                while let Ok((q, meta)) = ds.recv() {
                    let q = q.to_vec();
                    let mut end = 12;
                    while end < q.len() && q[end] != 0 { end += q[end] as usize + 1; }
                    let qend = end + 5;
                    let mut r = q[..2].to_vec();
                    r.extend_from_slice(&[0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]);
                    r.extend_from_slice(&q[12..qend]);
                    r.extend_from_slice(&[0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 10, 0, 0, 1]);
                    let _ = ds.send_slice(&r, meta.endpoint);
                }
                // echo on port 7, and always keep a listener ready
                let mut need_listener = true;
                for h in listeners.clone() {
                    let s = sockets.get_mut::<tcp::Socket>(h);
                    if s.state() == tcp::State::Listen { need_listener = false; }
                    if s.can_recv() && s.can_send() {
                        let mut data = Vec::new();
                        let _ = s.recv(|d| { data.extend_from_slice(d); (d.len(), ()) });
                        e2.fetch_add(data.len(), std::sync::atomic::Ordering::SeqCst);
                        let _ = s.send_slice(&data);
                    }
                    if s.state() == tcp::State::CloseWait { s.close(); }
                }
                if need_listener { listeners.push(listen(&mut sockets)); }
                iface.poll(now(), &mut dev, &mut sockets);
                while let Some(p) = dev.tx.pop_front() {
                    if let (TunnResult::WriteToNetwork(b), Some(to)) = (tunn.encapsulate(&p, &mut out), peer) { let _ = udp.send_to(b, to).await; }
                }
                if let (TunnResult::WriteToNetwork(b), Some(to)) = (tunn.update_timers(&mut out), peer) { let _ = udp.send_to(b, to).await; }
                tokio::select! { _ = udp.readable() => {}, _ = tokio::time::sleep(Duration::from_millis(10)) => {} }
            }
        });
        (port, echoed)
    }

    fn keys() -> ([u8; 32], [u8; 32]) {
        let s = StaticSecret::random_from_rng(rand_core::OsRng);
        let p = PublicKey::from(&s);
        (s.to_bytes(), p.to_bytes())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn browses_through_a_wireguard_server_with_dns_inside_the_tunnel() {
        let (cpriv, cpub) = keys();
        let (spriv, spub) = keys();
        let (port, echoed) = server(spriv, cpub).await;
        let b64 = |k: [u8; 32]| base64::engine::general_purpose::STANDARD.encode(k);
        let conf = format!("[Interface]\nPrivateKey = {}\nAddress = 10.0.0.2/32\nDNS = 10.0.0.1\n\n[Peer]\nPublicKey = {}\nAllowedIPs = 0.0.0.0/0\nEndpoint = 127.0.0.1:{port}\n", b64(cpriv), b64(spub));
        let wg = Wg::start(parse(&conf).unwrap()).await.unwrap();
        for round in 0..3 {
            let mut conn = wg.connect(Target { host: Host::Domain("echo.test".into()), port: 7 }).await.unwrap();
            let msg = format!("hej gennem wireguard {round} ").repeat(400).into_bytes(); // bigger than one packet
            conn.to_remote.send(msg.clone()).await.unwrap();
            conn.wake.notify_one();
            let mut got = Vec::new();
            while got.len() < msg.len() {
                let b = tokio::time::timeout(Duration::from_secs(10), conn.from_remote.recv()).await.expect("svar gennem tunnellen").unwrap();
                conn.wake.notify_one();
                got.extend_from_slice(&b);
            }
            assert_eq!(got, msg);
            conn.to_remote.send(Vec::new()).await.unwrap();
        }
        assert!(echoed.load(std::sync::atomic::Ordering::SeqCst) > 3 * 8000);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn wrong_key_times_out_with_a_clear_message() {
        let (cpriv, _) = keys();
        let (spriv, spub) = keys();
        let (_, other) = keys();
        let (port, _) = server(spriv, other).await; // the server doesn't know this client
        let b64 = |k: [u8; 32]| base64::engine::general_purpose::STANDARD.encode(k);
        let conf = format!("[Interface]\nPrivateKey = {}\nAddress = 10.0.0.2/32\nDNS = 10.0.0.1\n[Peer]\nPublicKey = {}\nEndpoint = 127.0.0.1:{port}\n", b64(cpriv), b64(spub));
        let wg = Wg::start(parse(&conf).unwrap()).await.unwrap();
        let err = tokio::time::timeout(Duration::from_secs(40), wg.connect(Target { host: Host::V4([10, 0, 0, 1]), port: 7 })).await.unwrap().err().unwrap();
        assert!(err.contains("svarer ikke"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_browser_proxy_uses_wireguard() {
        let (cpriv, cpub) = keys();
        let (spriv, spub) = keys();
        let (port, _) = server(spriv, cpub).await;
        let b64 = |k: [u8; 32]| base64::engine::general_purpose::STANDARD.encode(k);
        let conf = format!("[Interface]\nPrivateKey = {}\nAddress = 10.0.0.2/32\nDNS = 10.0.0.1\n[Peer]\nPublicKey = {}\nEndpoint = 127.0.0.1:{port}\n", b64(cpriv), b64(spub));
        let vpn = super::super::relay::Vpn { id: String::new(), kind: "wireguard".into(), host: String::new(), port: 0, conf: Some(conf), user: None, pass: None, name: "Gratis".into() };
        let relay = super::super::relay::start(vpn, Arc::new(|_| {})).await.unwrap();
        // the browser: SOCKS5 to the local relay, by host name
        let mut c = TcpStream::connect(("127.0.0.1", relay.port)).await.unwrap();
        c.write_all(&[5, 1, 0]).await.unwrap();
        let mut g = [0u8; 2]; c.read_exact(&mut g).await.unwrap();
        let mut req = vec![5, 1, 0, 3, 9]; req.extend_from_slice(b"echo.test"); req.extend_from_slice(&7u16.to_be_bytes());
        c.write_all(&req).await.unwrap();
        let mut r = [0u8; 10]; c.read_exact(&mut r).await.unwrap();
        assert_eq!(r[1], 0);
        c.write_all(b"GET / HTTP/1.1").await.unwrap();
        let mut back = [0u8; 14]; tokio::time::timeout(Duration::from_secs(10), c.read_exact(&mut back)).await.unwrap().unwrap();
        assert_eq!(&back, b"GET / HTTP/1.1");
        // a bad file is refused with a clear message
        let bad = super::super::relay::Vpn { id: String::new(), kind: "wireguard".into(), host: String::new(), port: 0, conf: Some("[Interface]\n".into()), user: None, pass: None, name: String::new() };
        assert!(super::super::relay::start(bad, Arc::new(|_| {})).await.err().unwrap().to_string().contains("PrivateKey"));
    }
}
