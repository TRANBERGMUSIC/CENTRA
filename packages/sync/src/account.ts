/** Account keys: create on the first device, unlock on every other device with the same passphrase. */
import { deriveMasterKey, newKdfParams, randomKey, wrapKey, unwrapKey, KeyRing, randomId, type KdfParams, type WrappedKey } from '@centra/crypto';

export type AccountKeys = { kdf: KdfParams; wrapped: WrappedKey[] };

export function createAccount(passphrase: string, profile: 'moderate' | 'interactive' = 'moderate') {
  const kdf = newKdfParams(profile);
  const master = deriveMasterKey(passphrase, kdf);
  const keyId = 'k' + randomId(4);
  const content = randomKey();
  const record: AccountKeys = { kdf, wrapped: [wrapKey(content, master, keyId)] };
  return { record, keys: new KeyRing(keyId, content), master };
}

/** Throws if the passphrase is wrong (the wrapped key fails authentication). */
export function unlockAccount(passphrase: string, record: AccountKeys) {
  const master = deriveMasterKey(passphrase, record.kdf);
  const [first, ...rest] = record.wrapped;
  const keys = new KeyRing(first.keyId, unwrapKey(first, master));
  for (const w of rest) keys.add(w.keyId, unwrapKey(w, master), true);
  return { keys, master };
}

/** New content key for everything written from now on (after a device is logged out). */
export function rotateKey(record: AccountKeys, keys: KeyRing, master: Uint8Array): AccountKeys {
  const keyId = 'k' + randomId(4);
  const content = randomKey();
  keys.add(keyId, content, true);
  return { ...record, wrapped: [...record.wrapped, wrapKey(content, master, keyId)] };
}
