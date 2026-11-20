import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  channelOpens,
  codeHint,
  codeIdOf,
  generateCode,
  isInstallId,
  normaliseCode,
} from '../src/codes.js';
import { expiryFor, GRACE_SECONDS } from '../src/token.js';

describe('codes', () => {
  it('makes readable codes with no look-alike characters', () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateCode();
      expect(code).toMatch(/^RB-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    }
    expect(CODE_ALPHABET).not.toMatch(/[01ILO]/);
  });

  it('reads what a player typed', () => {
    expect(normaliseCode('rb-7k3m-q9tx')).toBe('RB-7K3M-Q9TX');
    expect(normaliseCode(' RB 7K3M Q9TX ')).toBe('RB-7K3M-Q9TX');
    expect(normaliseCode('7K3MQ9TX')).toBe('RB-7K3M-Q9TX');
    expect(normaliseCode('RB-7K3M-Q9T')).toBeNull();
    expect(normaliseCode('RB-7K3M-Q9T0')).toBeNull();
    expect(normaliseCode(42)).toBeNull();
  });

  it('keys a code by a hash, and shows only its first half', () => {
    expect(codeIdOf('RB-7K3M-Q9TX')).toBe(codeIdOf('RB-7K3M-Q9TX'));
    expect(codeIdOf('RB-7K3M-Q9TX')).not.toBe(codeIdOf('RB-7K3M-Q9TY'));
    expect(codeIdOf('RB-7K3M-Q9TX')).toMatch(/^c[0-9a-f]{20}$/);
    expect(codeHint('RB-7K3M-Q9TX')).toBe('RB-7K3M');
  });

  it('lets alpha codes open beta builds but not the other way round', () => {
    expect(channelOpens('alpha', 'alpha')).toBe(true);
    expect(channelOpens('alpha', 'beta')).toBe(true);
    expect(channelOpens('beta', 'beta')).toBe(true);
    expect(channelOpens('beta', 'alpha')).toBe(false);
  });

  it('checks install ids', () => {
    expect(isInstallId('0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d')).toBe(true);
    expect(isInstallId('short')).toBe(false);
    expect(isInstallId('has space in it')).toBe(false);
  });

  it('caps a token at the code expiry', () => {
    expect(expiryFor(100, undefined)).toBe(100 + GRACE_SECONDS);
    expect(expiryFor(100, 200)).toBe(200);
  });
});
