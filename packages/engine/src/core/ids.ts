/**
 * Entity IDs.
 *
 * Every entity is referenced by a branded string ID such as `per_3k9x0d7m2q`: a three letter
 * prefix naming the entity kind, an underscore, and a 10 character body in lowercase Crockford
 * base32. The brand makes it a compile error to pass a promotion ID where a person ID is expected,
 * and the prefix makes a stray ID in a save or a log readable at a glance.
 *
 * New IDs are minted by an `IdFactory` over an injected `IdEntropy`, so the seeded RNG decides
 * every ID and a replay recreates the same ones.
 */

import type { Brand } from './brand';
import { IdCollisionError, InvalidArgumentError, InvalidIdError } from './errors';

export type { Brand } from './brand';

/** Every entity kind and its ID prefix. Prefixes are unique and exactly three characters. */
export const ENTITY_KINDS = {
  person: 'per',
  employment: 'emp',
  promotion: 'pro',
  brand: 'brd',
  title: 'tit',
  titleReign: 'trn',
  eventDefinition: 'evd',
  eventInstance: 'evi',
  segment: 'seg',
  participant: 'ptc',
  storyline: 'sty',
  team: 'tem',
  stable: 'stb',
  network: 'net',
  deal: 'dea',
  venue: 'ven',
  continent: 'ctn',
  country: 'cty',
  region: 'reg',
  relationship: 'rel',
  mail: 'mai',
  news: 'nws',
  ledgerEntry: 'led',
  season: 'sea',
} as const;

export type EntityKind = keyof typeof ENTITY_KINDS;
export type IdPrefix = (typeof ENTITY_KINDS)[EntityKind];

/** The ID type of one entity kind. Distributes over unions, so `IdOf<EntityKind>` is any ID. */
export type IdOf<K extends EntityKind> = K extends EntityKind ? Brand<string, `${K}Id`> : never;

export type PersonId = IdOf<'person'>;
export type EmploymentId = IdOf<'employment'>;
export type PromotionId = IdOf<'promotion'>;
export type BrandId = IdOf<'brand'>;
export type TitleId = IdOf<'title'>;
export type TitleReignId = IdOf<'titleReign'>;
export type EventDefinitionId = IdOf<'eventDefinition'>;
export type EventInstanceId = IdOf<'eventInstance'>;
export type SegmentId = IdOf<'segment'>;
export type ParticipantId = IdOf<'participant'>;
export type StorylineId = IdOf<'storyline'>;
export type TeamId = IdOf<'team'>;
export type StableId = IdOf<'stable'>;
export type NetworkId = IdOf<'network'>;
export type DealId = IdOf<'deal'>;
export type VenueId = IdOf<'venue'>;
export type ContinentId = IdOf<'continent'>;
export type CountryId = IdOf<'country'>;
export type RegionId = IdOf<'region'>;
export type RelationshipId = IdOf<'relationship'>;
export type MailId = IdOf<'mail'>;
export type NewsId = IdOf<'news'>;
export type LedgerEntryId = IdOf<'ledgerEntry'>;
export type SeasonId = IdOf<'season'>;

/** Lowercase Crockford base32: digits and letters without i, l, o and u. Index = 5-bit value. */
export const ID_BODY_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
/** Number of characters in an ID body. */
export const ID_BODY_LENGTH = 10;

const ID_BODY_SOURCE = `[0-9a-hjkmnp-tv-z]{${String(ID_BODY_LENGTH)}}`;

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && Object.hasOwn(ENTITY_KINDS, value);
}

/** All entity kinds, in declaration order. */
export const ENTITY_KIND_LIST: readonly EntityKind[] =
  Object.keys(ENTITY_KINDS).filter(isEntityKind);

function hasPatternForEveryKind(
  table: Partial<Record<EntityKind, RegExp>>,
): table is Record<EntityKind, RegExp> {
  return ENTITY_KIND_LIST.every((kind) => table[kind] !== undefined);
}

function buildIdPatterns(): Readonly<Record<EntityKind, RegExp>> {
  const table: Partial<Record<EntityKind, RegExp>> = {};
  for (const kind of ENTITY_KIND_LIST) {
    table[kind] = new RegExp(`^${ENTITY_KINDS[kind]}_${ID_BODY_SOURCE}$`);
  }
  if (!hasPatternForEveryKind(table)) {
    throw new InvalidArgumentError('buildIdPatterns', 'ENTITY_KINDS', null, 'a prefix per kind');
  }
  return Object.freeze(table);
}

/** The full-match pattern for each kind's IDs, for example `/^per_[0-9a-hjkmnp-tv-z]{10}$/`. */
export const ID_PATTERN: Readonly<Record<EntityKind, RegExp>> = buildIdPatterns();

const KIND_BY_PREFIX: ReadonlyMap<string, EntityKind> = new Map(
  ENTITY_KIND_LIST.map((kind) => [ENTITY_KINDS[kind], kind]),
);

/** True when `value` is a well-formed ID of the given kind. */
export function isId<K extends EntityKind>(kind: K, value: unknown): value is IdOf<K> {
  return typeof value === 'string' && ID_PATTERN[kind].test(value);
}

/** Returns `value` as an ID of the given kind, or throws `InvalidIdError` naming the bad value. */
export function parseId<K extends EntityKind>(kind: K, value: unknown): IdOf<K> {
  if (!isId(kind, value)) {
    throw new InvalidIdError(kind, value);
  }
  return value;
}

/** The entity kind of a well-formed ID, or null when `value` is not an ID of any kind. */
export function kindOfId(value: unknown): EntityKind | null {
  if (typeof value !== 'string') {
    return null;
  }
  const kind = KIND_BY_PREFIX.get(value.slice(0, 3));
  return kind !== undefined && ID_PATTERN[kind].test(value) ? kind : null;
}

/** A source of random 32-bit unsigned integers. In the game this is a seeded RNG stream. */
export interface IdEntropy {
  /** Returns an integer in 0..2^32-1 (both ends included). */
  nextUint32(): number;
}

export interface IdFactory {
  /**
   * Mints a new ID of `kind`. `exists` reports whether a candidate is already taken; a taken
   * candidate is discarded and a new one drawn, up to `ID_MAX_ATTEMPTS` candidates in total.
   */
  next<K extends EntityKind>(kind: K, exists: (id: IdOf<K>) => boolean): IdOf<K>;
}

/** How many candidates the factory draws before giving up with `IdCollisionError`. */
export const ID_MAX_ATTEMPTS = 8;

const BITS_PER_CHAR = 5;
/** Each ID body is two halves of 25 bits; each half comes from the top bits of one draw. */
const BITS_PER_HALF = 25;
const CHARS_PER_HALF = BITS_PER_HALF / BITS_PER_CHAR;
const DISCARDED_LOW_BITS = 32 - BITS_PER_HALF;
const MAX_UINT32 = 0xffff_ffff;

function drawHalf(entropy: IdEntropy): number {
  const draw = entropy.nextUint32();
  if (!Number.isInteger(draw) || draw < 0 || draw > MAX_UINT32) {
    throw new InvalidArgumentError(
      'IdEntropy.nextUint32',
      'return value',
      draw,
      'an integer in 0..4294967295',
    );
  }
  return draw >>> DISCARDED_LOW_BITS;
}

function encodeHalf(half: number): string {
  let encoded = '';
  for (let charIndex = CHARS_PER_HALF - 1; charIndex >= 0; charIndex -= 1) {
    const fiveBits = (half >>> (charIndex * BITS_PER_CHAR)) & 0b11111;
    encoded += ID_BODY_ALPHABET.charAt(fiveBits);
  }
  return encoded;
}

/**
 * Draws one 10 character ID body: 50 bits from two `nextUint32()` calls. The top 25 bits of the
 * first draw become the first five characters and the top 25 bits of the second draw the last five.
 */
function drawIdBody(entropy: IdEntropy): string {
  const highHalf = drawHalf(entropy);
  const lowHalf = drawHalf(entropy);
  return encodeHalf(highHalf) + encodeHalf(lowHalf);
}

/**
 * Creates an ID factory over `entropy`. The factory keeps no state of its own, so two factories
 * over the same entropy sequence mint the same IDs.
 */
export function createIdFactory(entropy: IdEntropy): IdFactory {
  return {
    next<K extends EntityKind>(kind: K, exists: (id: IdOf<K>) => boolean): IdOf<K> {
      const prefix = ENTITY_KINDS[kind];
      for (let attempt = 1; attempt <= ID_MAX_ATTEMPTS; attempt += 1) {
        const candidate = parseId(kind, `${prefix}_${drawIdBody(entropy)}`);
        if (!exists(candidate)) {
          return candidate;
        }
      }
      throw new IdCollisionError(kind, ID_MAX_ATTEMPTS);
    },
  };
}
