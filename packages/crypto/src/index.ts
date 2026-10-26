/**
 * @centra/crypto — end-to-end encryption for everything that leaves a device.
 *
 *  passphrase ──Argon2id(salt)──▶ masterKey (never stored on the server, never leaves the device)
 *  masterKey  ──wraps──▶ contentKey (random, 32 bytes; the wrapped copy is stored on the server)
 *  contentKey ──XChaCha20-Poly1305(aad = entity/device binding)──▶ every change
 *
 * Rotating the content key (e.g. after logging a device out) re-wraps a new key; old
 * changes stay readable through a key ring addressed by key id.
 */
import sodiumModule from 'libsodium-wrappers-sumo';

let sodium: typeof sodiumModule;
export async function ready(): Promise<void> {
  if (!sodium) {
    await sodiumModule.ready;
    sodium = sodiumModule;
  }
}
const s = () => {
  if (!sodium) throw new Error('@centra/crypto: call ready() first');
  return sodium;
};

export type Bytes = Uint8Array;

export type KdfParams = { salt: string; ops: number; mem: number };

/** Moderate profile: ~0.5 s on a phone. Tests use the interactive profile. */
export function newKdfParams(profile: 'moderate' | 'interactive' = 'moderate'): KdfParams {
  const so = s();
  return {
    salt: so.to_base64(so.randombytes_buf(so.crypto_pwhash_SALTBYTES)),
    // moderate: 4 passes over 64 MiB — well above OWASP's Argon2id minimum, and still under a
    // second on a phone (256 MiB, libsodium's own "moderate", is too much for mobile WebViews).
    ops: profile === 'moderate' ? 4 : so.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    mem: 64 * 1024 * 1024,
  };
}

export function deriveMasterKey(passphrase: string, p: KdfParams): Bytes {
  const so = s();
  return so.crypto_pwhash(32, passphrase, so.from_base64(p.salt), p.ops, p.mem, so.crypto_pwhash_ALG_ARGON2ID13);
}

/**
 * One Argon2id run, two independent keys:
 *   enc  — unwraps the account key; never leaves the device
 *   auth — proves the password to the server; the server stores only SHA-256(auth), so a stolen
 *          server database neither decrypts anything nor logs in.
 */
export function deriveKeys(secret: string, p: KdfParams): { enc: Bytes; auth: string } {
  const so = s();
  const out = so.crypto_pwhash(64, secret.normalize('NFKC'), so.from_base64(p.salt), p.ops, p.mem, so.crypto_pwhash_ALG_ARGON2ID13);
  const enc = so.crypto_generichash(32, out.subarray(0, 32), utf8.encode('centra/enc/v1'));
  const auth = so.crypto_generichash(32, out.subarray(32), utf8.encode('centra/auth/v1'));
  so.memzero(out);
  return { enc, auth: so.to_base64(auth, so.base64_variants.ORIGINAL) };
}

/** 25 random characters from an unambiguous alphabet, shown once as XXXXX-XXXXX-XXXXX-XXXXX-XXXXX (~124 bits). */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRecoveryCode(): string {
  const so = s();
  const bytes = so.randombytes_buf(25);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % 32]).join('');
  return chars.match(/.{5}/g)!.join('-');
}
export const normalizeRecoveryCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Wipe key material from memory where the platform allows it. */
export function wipe(b?: Bytes | null) {
  if (b) s().memzero(b);
}

export function randomKey(): Bytes {
  return s().crypto_aead_xchacha20poly1305_ietf_keygen();
}

const NONCE = 24;

/** nonce ‖ ciphertext. `aad` binds the ciphertext to its context so it cannot be replayed elsewhere. */
export function seal(plain: Bytes, key: Bytes, aad = ''): Bytes {
  const so = s();
  const nonce = so.randombytes_buf(NONCE);
  const ct = so.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, aad || null, null, nonce, key);
  const out = new Uint8Array(NONCE + ct.length);
  out.set(nonce);
  out.set(ct, NONCE);
  return out;
}

export function open(sealed: Bytes, key: Bytes, aad = ''): Bytes {
  const so = s();
  if (sealed.length < NONCE + 16) throw new Error('ciphertext too short');
  return so.crypto_aead_xchacha20poly1305_ietf_decrypt(null, sealed.subarray(NONCE), aad || null, sealed.subarray(0, NONCE), key);
}

export const utf8 = { encode: (t: string) => new TextEncoder().encode(t), decode: (b: Bytes) => new TextDecoder().decode(b) };
export const b64 = {
  encode: (b: Bytes) => s().to_base64(b, s().base64_variants.ORIGINAL),
  decode: (t: string) => s().from_base64(t, s().base64_variants.ORIGINAL),
};

export function sealJson(value: unknown, key: Bytes, aad = ''): string {
  return b64.encode(seal(utf8.encode(JSON.stringify(value)), key, aad));
}
export function openJson<T = unknown>(sealed: string, key: Bytes, aad = ''): T {
  return JSON.parse(utf8.decode(open(b64.decode(sealed), key, aad))) as T;
}

/** The content key, wrapped by the master key, as stored on the server. */
export type WrappedKey = { keyId: string; sealed: string };
export function wrapKey(contentKey: Bytes, masterKey: Bytes, keyId: string): WrappedKey {
  return { keyId, sealed: b64.encode(seal(contentKey, masterKey, `key:${keyId}`)) };
}
export function unwrapKey(w: WrappedKey, masterKey: Bytes): Bytes {
  return open(b64.decode(w.sealed), masterKey, `key:${w.keyId}`);
}

/** Holds every content key this account has used, addressed by key id. */
export class KeyRing {
  private keys = new Map<string, Bytes>();
  current: string;
  constructor(keyId: string, key: Bytes) {
    this.keys.set(keyId, key);
    this.current = keyId;
  }
  add(keyId: string, key: Bytes, makeCurrent = false) {
    this.keys.set(keyId, key);
    if (makeCurrent) this.current = keyId;
  }
  get(keyId: string): Bytes {
    const k = this.keys.get(keyId);
    if (!k) throw new Error(`unknown key ${keyId}`);
    return k;
  }
}

export function randomId(bytes = 16): string {
  const so = s();
  return so.to_hex(so.randombytes_buf(bytes));
}

/** A sub-key for one purpose, derived from a parent key (BLAKE2b keyed hash). */
export function subKey(parent: Bytes, purpose: string): Bytes {
  return s().crypto_generichash(32, utf8.encode('centra/' + purpose), parent);
}
