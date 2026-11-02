/**
 * Apple's push service (APNs) with a token key (.p8): one JWT signed with ES256, reused for 50 min,
 * then an HTTP/2 request per device. Returns the tokens Apple says are gone, so the relay drops them.
 */
import type { PushItem, PushTarget } from '@centra/relay-core';

type Keys = { APNS_KEY?: string; APNS_KEY_ID?: string; APNS_TEAM_ID?: string; APNS_TOPIC?: string };

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ''; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function importKey(pem: string): Promise<CryptoKey> {
  const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export function apnsSender(env: Keys) {
  if (!env.APNS_KEY || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return null;
  const topic = env.APNS_TOPIC || 'dk.tranberg.centra';
  let key: Promise<CryptoKey> | null = null;
  let jwt: { token: string; at: number } | null = null;
  async function bearer() {
    const now = Math.floor(Date.now() / 1000);
    if (jwt && now - jwt.at < 50 * 60) return jwt.token;
    key ??= importKey(env.APNS_KEY!);
    const head = b64url(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID }));
    const body = b64url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now }));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await key, new TextEncoder().encode(`${head}.${body}`));
    jwt = { token: `${head}.${body}.${b64url(sig)}`, at: now };
    return jwt.token;
  }
  return async (targets: PushTarget[], item: PushItem) => {
    const auth = await bearer();
    const payload = JSON.stringify({ aps: { alert: { title: item.title, body: item.body }, sound: 'default', 'thread-id': item.id.split(':')[0] }, id: item.id });
    const bad: string[] = [], errors: string[] = [];
    await Promise.all(targets.map(async (t) => {
      const host = t.env === 'development' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
      const r = await fetch(`https://${host}/3/device/${t.token}`, {
        method: 'POST', body: payload,
        headers: {
          authorization: `bearer ${auth}`, 'apns-topic': topic, 'apns-push-type': 'alert', 'apns-priority': '10',
          // A phone that is off or offline gets it when it's back (up to a day later), once.
          'apns-expiration': String(Math.floor(item.at / 1000) + 86_400), 'apns-collapse-id': item.id.slice(0, 64),
        },
      }).catch(() => null);
      if (!r) { errors.push('Apple svarede ikke'); return; }
      if (r.status === 200) return;
      const why = ((await r.json().catch(() => ({}))) as { reason?: string }).reason ?? String(r.status);
      if (r.status === 410 || why === 'BadDeviceToken' || why === 'DeviceTokenNotForTopic') bad.push(t.token);
      else errors.push(why); // e.g. InvalidProviderToken: the key, Key ID or Team ID is wrong
    }));
    return { bad, errors };
  };
}
