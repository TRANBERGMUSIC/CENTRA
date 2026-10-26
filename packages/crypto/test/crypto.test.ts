import { describe, it, expect, beforeAll } from 'vitest';
import { ready, newKdfParams, deriveMasterKey, randomKey, seal, open, sealJson, openJson, wrapKey, unwrapKey, utf8 } from '../src/index.ts';

beforeAll(ready);

describe('crypto', () => {
  it('round-trips and authenticates', () => {
    const k = randomKey();
    const s = seal(utf8.encode('Lysplan til julekoncert'), k, 'env:1');
    expect(utf8.decode(open(s, k, 'env:1'))).toBe('Lysplan til julekoncert');
  });
  it('rejects the wrong key, the wrong context and tampering', () => {
    const k = randomKey();
    const s = seal(utf8.encode('hemmelig'), k, 'env:1');
    expect(() => open(s, randomKey(), 'env:1')).toThrow();
    expect(() => open(s, k, 'env:2')).toThrow();
    const t = s.slice(); t[30] ^= 1;
    expect(() => open(t, k, 'env:1')).toThrow();
  });
  it('derives the same master key from the same passphrase, and a different one otherwise', () => {
    const p = newKdfParams('interactive');
    const a = deriveMasterKey('korrekt hest batteri hæfteklamme', p);
    expect(deriveMasterKey('korrekt hest batteri hæfteklamme', p)).toEqual(a);
    expect(deriveMasterKey('forkert', p)).not.toEqual(a);
  });
  it('wraps the content key under the master key', () => {
    const m = randomKey(), c = randomKey();
    const w = wrapKey(c, m, 'k1');
    expect(unwrapKey(w, m)).toEqual(c);
    expect(() => unwrapKey(w, randomKey())).toThrow();
  });
  it('seals JSON with no readable plaintext', () => {
    const k = randomKey();
    const s = sealJson({ title: 'Faktura 2026-118' }, k);
    expect(s).not.toContain('Faktura');
    expect(openJson(s, k)).toEqual({ title: 'Faktura 2026-118' });
  });
});
