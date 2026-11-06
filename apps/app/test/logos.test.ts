import { describe, it, expect } from 'vitest';
import { logoDomain } from '../src/logos.ts';

describe('company logos', () => {
  it('finds the company behind an address', () => {
    expect(logoDomain('no-reply@accounts.google.com')).toBe('google.com');
    expect(logoDomain('info@mail.netflix.com')).toBe('netflix.com');
    expect(logoDomain('nyhedsbrev@netto.dk')).toBe('netto.dk');
    expect(logoDomain('news@bbc.co.uk')).toBe('bbc.co.uk');
  });
  it('leaves people on private mail services with their initials', () => {
    expect(logoDomain('sigge@gmail.com')).toBeNull();
    expect(logoDomain('mor@hotmail.dk')).toBeNull();
    expect(logoDomain('x@icloud.com')).toBeNull();
    expect(logoDomain('')).toBeNull();
    expect(logoDomain('nonsense')).toBeNull();
  });
});
