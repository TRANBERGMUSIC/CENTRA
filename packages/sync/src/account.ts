/**
 * Account keys, end to end.
 *
 *   password ─Argon2id─▶ { enc, auth }        recovery code ─Argon2id─▶ { enc', auth' }
 *            enc  wraps ─▶ AK (account key) ◀─ wraps  enc'
 *            AK   wraps ─▶ content keys (k1, k2, … one per rotation)
 *            content key seals every change
 *
 * The server stores the wrapped AK twice (by password and by recovery code), the wrapped content
 * keys, and SHA-256 of the two auth values. It can verify a login but can never unwrap anything.
 * Changing the password re-wraps only the AK; rotating keys after logging a device out adds a
 * content key; the recovery code can set a new password when the old one is forgotten.
 */
import {
  b64, deriveKeys, newKdfParams, newRecoveryCode, normalizeRecoveryCode, open, randomId, randomKey, seal,
  unwrapKey, wipe, wrapKey, KeyRing, type Bytes, type KdfParams, type WrappedKey,
} from '@centra/crypto';

export type AccountPublic = {
  v: 2;
  kdf: KdfParams;
  wrappedAK: string;
  recovery: { kdf: KdfParams; wrappedAK: string };
  keys: WrappedKey[];
};

type Profile = 'moderate' | 'interactive';
const sealAK = (ak: Bytes, enc: Bytes) => b64.encode(seal(ak, enc, 'ak:v2'));
const openAK = (w: string, enc: Bytes) => open(b64.decode(w), enc, 'ak:v2');

function ringFrom(keys: WrappedKey[], ak: Bytes): KeyRing {
  const [first, ...rest] = keys;
  const ring = new KeyRing(first.keyId, unwrapKey(first, ak));
  for (const w of rest) ring.add(w.keyId, unwrapKey(w, ak), true);
  return ring;
}

export function createAccount(password: string, profile: Profile = 'moderate') {
  const ak = randomKey();
  const pw = newKdfParams(profile);
  const rc = newKdfParams(profile);
  const recoveryCode = newRecoveryCode();
  const p = deriveKeys(password, pw);
  const r = deriveKeys(normalizeRecoveryCode(recoveryCode), rc);
  const keyId = 'k' + randomId(4);
  const content = randomKey();
  const account: AccountPublic = {
    v: 2,
    kdf: pw,
    wrappedAK: sealAK(ak, p.enc),
    recovery: { kdf: rc, wrappedAK: sealAK(ak, r.enc) },
    keys: [wrapKey(content, ak, keyId)],
  };
  wipe(p.enc); wipe(r.enc);
  return { account, auth: p.auth, recoveryAuth: r.auth, recoveryCode, ak, keys: new KeyRing(keyId, content) };
}

/** Password → auth (for the server) and enc (kept to unlock). Slow on purpose (Argon2id). */
export const passwordSecrets = (password: string, kdf: KdfParams) => deriveKeys(password, kdf);

/** Throws when the password is wrong. */
export function unlock(account: AccountPublic, enc: Bytes) {
  let ak: Bytes;
  try { ak = openAK(account.wrappedAK, enc); } catch { throw new Error('wrong-password'); }
  return { ak, keys: ringFrom(account.keys, ak) };
}

export function changePassword(ak: Bytes, newPassword: string, profile: Profile = 'moderate') {
  const kdf = newKdfParams(profile);
  const p = deriveKeys(newPassword, kdf);
  const out = { kdf, wrappedAK: sealAK(ak, p.enc), auth: p.auth };
  wipe(p.enc);
  return out;
}

/** Recovery code → proof for the server, the AK, and a fresh password wrap. Throws on a wrong code. */
export function recoverWithCode(recovery: AccountPublic['recovery'], code: string, newPassword: string, profile: Profile = 'moderate') {
  const r = deriveKeys(normalizeRecoveryCode(code), recovery.kdf);
  let ak: Bytes;
  try { ak = openAK(recovery.wrappedAK, r.enc); } catch { throw new Error('wrong-recovery-code'); }
  wipe(r.enc);
  return { recoveryAuth: r.auth, ak, password: changePassword(ak, newPassword, profile) };
}

/** A new recovery code; the previous one stops working once the server accepts this. */
export function newRecovery(ak: Bytes, profile: Profile = 'moderate') {
  const kdf = newKdfParams(profile);
  const code = newRecoveryCode();
  const r = deriveKeys(normalizeRecoveryCode(code), kdf);
  const out = { code, recovery: { kdf, wrappedAK: sealAK(ak, r.enc) }, recoveryAuth: r.auth };
  wipe(r.enc);
  return out;
}

/** A new content key for everything written from now on (after logging a device out). */
export function rotateContentKey(account: AccountPublic, ak: Bytes, keys: KeyRing): WrappedKey[] {
  const keyId = 'k' + randomId(4);
  const content = randomKey();
  keys.add(keyId, content, true);
  return [...account.keys, wrapKey(content, ak, keyId)];
}

/** Add keys that another device rotated in. */
export function absorbKeys(keys: KeyRing, wrapped: WrappedKey[], ak: Bytes) {
  for (const w of wrapped) {
    try { keys.get(w.keyId); } catch { keys.add(w.keyId, unwrapKey(w, ak), true); }
  }
}

export const normalizeUser = (u: string) => u.trim().toLowerCase();
