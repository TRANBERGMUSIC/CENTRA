import { describe, it, expect, beforeAll } from 'vitest';
import { ready, randomKey, KeyRing } from '@centra/crypto';
import { SyncEngine, MemoryHub, MemoryRelay, MemoryStore } from '@centra/sync';
import { arrange, saveLayout, resetLayout, move } from '../src/home.ts';

beforeAll(ready);
const M = [{ id: 'day', size: 'full' as const, on: true }, { id: 'next', size: 'small' as const, on: true }, { id: 'money', size: 'full' as const, on: true }];

describe('forsiden', () => {
  it('keeps your order, sizes and hidden modules per device, and takes new modules in by itself', async () => {
    const e = new SyncEngine({ device: 'mac', keys: new KeyRing('kabcd', randomKey()), store: new MemoryStore(), relay: new MemoryRelay(new MemoryHub()), flushMs: 5 });
    await e.start();
    let items = arrange(e, 'desk', M);
    expect(items.map((x) => x.id)).toEqual(['day', 'next', 'money']);
    items = move(items, 'money', -1);
    items = items.map((x) => (x.id === 'day' ? { ...x, hidden: true } : x.id === 'next' ? { ...x, size: 'large' as const } : x));
    saveLayout(e, 'desk', items);
    expect(arrange(e, 'desk', M).filter((x) => !x.hidden).map((x) => x.id)).toEqual(['money', 'next']);
    expect(arrange(e, 'desk', M).find((x) => x.id === 'next')?.size).toBe('large');
    expect(arrange(e, 'phone', M).map((x) => x.id)).toEqual(['day', 'next', 'money']); // the phone has its own
    // a module added later: shows up at the end, or waits in "Tilføj" when it starts hidden
    const later = [...M, { id: 'photos', size: 'full' as const, on: false }, { id: 'weather', size: 'small' as const, on: true }];
    const a = arrange(e, 'desk', later);
    expect(a.find((x) => x.id === 'photos')?.hidden).toBe(true);
    expect(a.filter((x) => !x.hidden).map((x) => x.id)).toEqual(['money', 'next', 'weather']);
    resetLayout(e, 'desk');
    expect(arrange(e, 'desk', M).map((x) => x.id)).toEqual(['day', 'next', 'money']);
  });
});
