/**
 * Deterministic hashing for placeholder art.
 *
 * Placeholder art is presentation, so it never draws from the engine's random streams (changing
 * the art must not change game results). FNV-1a over the entity id is cheap, stable across
 * reloads and the same in every browser.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const utf8Encoder = new TextEncoder();

function fnvStep(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
}

/** 32-bit FNV-1a of the UTF-8 bytes of `input`, as an unsigned integer. */
export function hashString(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of utf8Encoder.encode(input)) {
    hash = fnvStep(hash, byte);
  }
  return hash;
}

/**
 * Re-hashes `seed` with `salt` so separate choices for one entity (background colour, shape,
 * silhouette variant) are independent of each other. The salt bytes are folded in with FNV-1a and
 * the result goes through a final avalanche so the low bits used by `%` are well mixed even for
 * sequential ids.
 */
export function saltedHash(seed: number, salt: number): number {
  let hash = seed >>> 0;
  for (let shift = 0; shift < 32; shift += 8) {
    hash = fnvStep(hash, (salt >>> shift) & 0xff);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Picks one of `items` for `seed`. The same seed and salt always pick the same item. */
export function pick<T>(items: readonly T[], seed: number, salt: number): T {
  if (items.length === 0) {
    throw new Error('pick() needs at least one item to choose from.');
  }
  const chosen = items[saltedHash(seed, salt) % items.length];
  if (chosen === undefined) {
    throw new Error('pick() chose an index outside the list.');
  }
  return chosen;
}

/** Salts for each independent placeholder choice. Changing one re-rolls that choice everywhere. */
export const PLACEHOLDER_SALT = {
  background: 1,
  silhouette: 2,
  beltPlate: 3,
  logoShape: 4,
  logoInner: 5,
  venue: 6,
} as const;
