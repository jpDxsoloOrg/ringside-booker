import { createHash, randomInt } from 'node:crypto';

/**
 * Tester codes look like `RB-7K3M-Q9TX`: two groups of four from an alphabet with no look-alike
 * characters (no 0/O, 1/I/L), so a code read aloud or copied by hand still works.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_PREFIX = 'RB';
const GROUP = 4;
const BODY = GROUP * 2;

export const CHANNELS = ['alpha', 'beta'] as const;
export type Channel = (typeof CHANNELS)[number];

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

/**
 * Which builds a code opens. An alpha code is for the earliest testers, so it opens alpha and beta
 * builds; a beta code opens beta builds only.
 */
export function channelOpens(codeChannel: Channel, buildChannel: Channel): boolean {
  return codeChannel === 'alpha' || buildChannel === 'beta';
}

/** A new random code, e.g. `RB-7K3M-Q9TX` (31^8, about 8.5e11 codes). */
export function generateCode(pick: (max: number) => number = randomInt): string {
  let body = '';
  for (let index = 0; index < BODY; index += 1) {
    body += CODE_ALPHABET.charAt(pick(CODE_ALPHABET.length));
  }
  return format(body);
}

function format(body: string): string {
  return `${CODE_PREFIX}-${body.slice(0, GROUP)}-${body.slice(GROUP)}`;
}

/**
 * The canonical form of what a player typed: capitals, no spaces, dashes put back. Returns null
 * when it can't be a code (wrong length or a character outside the alphabet).
 */
export function normaliseCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let compact = input.toUpperCase().replace(/[\s-]/g, '');
  if (compact.startsWith(CODE_PREFIX)) compact = compact.slice(CODE_PREFIX.length);
  if (compact.length !== BODY) return null;
  for (const character of compact) {
    if (!CODE_ALPHABET.includes(character)) return null;
  }
  return format(compact);
}

/**
 * The table key and the token's code id: a hash of the code, so a token never carries the code
 * itself, and refresh can find the code from the token alone.
 */
export function codeIdOf(code: string): string {
  return `c${createHash('sha256').update(code).digest('hex').slice(0, 20)}`;
}

/** The part of a code that may be shown: `RB-7K3M` (the About screen shows `RB-7K3M-••••`). */
export function codeHint(code: string): string {
  return code.slice(0, CODE_PREFIX.length + 1 + GROUP);
}

/** A random install id from the game: 8 to 64 letters, digits or dashes. */
export function isInstallId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);
}
