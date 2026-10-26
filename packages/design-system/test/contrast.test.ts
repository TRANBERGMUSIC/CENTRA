/** Every role that carries words reaches WCAG AA (4.5:1) on every surface it can sit on, in every theme. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { themes } from '../src/tokens.ts';

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

for (const [name, t] of Object.entries(themes)) {
  for (const fg of ['text', 'muted', 'faint', 'focusText', 'positive', 'negative', 'warning', 'calm'] as const) {
    for (const bg of ['ground', 'surface', 'raised', 'active'] as const) {
      test(`${name}: ${fg} on ${bg} ≥ 4.5`, () => {
        const c = contrast(t[fg], t[bg]);
        assert.ok(c >= 4.5, `${t[fg]} on ${t[bg]} = ${c.toFixed(2)}`);
      });
    }
  }
  test(`${name}: label on primary ≥ 4.5`, () => assert.ok(contrast(t.onPrimary, t.primary) >= 4.5));
  test(`${name}: focus mark on surface ≥ 3 (graphics)`, () => assert.ok(contrast(t.focus, t.surface) >= 3));
  test(`${name}: focusText on focusWash ≥ 4.5`, () => assert.ok(contrast(t.focusText, t.focusWash) >= 4.5));
  test(`${name}: ring visible on ground ≥ 3`, () => assert.ok(contrast(t.ring, t.ground) >= 3));
}
