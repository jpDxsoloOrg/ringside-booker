/**
 * Record keys and references in data packs.
 *
 * Pack records never carry engine IDs. Each record has a `key` that is unique within its kind
 * across every loaded pack, and records point at each other through fields named `<thing>Key` (or
 * `<thing>Keys` for lists) holding a reference: either a bare key (`pro-coastal`) or a key
 * qualified with the pack that defines it (`base-world:pro-coastal`). Display names are never
 * references, so renaming a promotion can never break a link to it.
 *
 * Pack keys are not `ContentKey`s. A `ContentKey` (`gimmick.monster-heel`) names a catalog entry
 * and stays a key at runtime. A pack key exists only until the pack is loaded, when the loader
 * (WLD-02) swaps it for a branded ID. The two have different patterns and different type names.
 *
 * Format doc: docs/design/data-packs.md.
 */

import { z } from 'zod';
import type { Brand } from '../../core/brand';

/** A record key: lowercase letters, digits and hyphens, starting with a letter or digit. */
export const PACK_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A pack ID: lowercase letters, digits and hyphens, starting with a letter, 2-40 characters. */
export const PACK_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

/** A reference: a record key, optionally qualified with the ID of the pack that defines it. */
export const PACK_REF_PATTERN = /^(?:([a-z][a-z0-9-]{1,39}):)?([a-z0-9][a-z0-9-]{0,63})$/;

export type PackKey = Brand<string, 'PackKey'>;
export type PackId = Brand<string, 'PackId'>;
export type PackRef = Brand<string, 'PackRef'>;

/** True when `value` is a well-formed record key. */
export function isPackKey(value: unknown): value is PackKey {
  return typeof value === 'string' && PACK_KEY_PATTERN.test(value);
}

/** True when `value` is a well-formed pack ID. */
export function isPackId(value: unknown): value is PackId {
  return typeof value === 'string' && PACK_ID_PATTERN.test(value);
}

/** True when `value` is a well-formed reference (`key` or `packId:key`). */
export function isPackRef(value: unknown): value is PackRef {
  return typeof value === 'string' && PACK_REF_PATTERN.test(value);
}

export const keySchema = z.custom<PackKey>(isPackKey, {
  message:
    'Expected a record key: 1-64 lowercase letters, digits and hyphens, such as "pro-coastal"',
});

export const packIdSchema = z.custom<PackId>(isPackId, {
  message:
    'Expected a pack ID: 2-40 lowercase letters, digits and hyphens starting with a letter, such as "base-world"',
});

export const refSchema = z.custom<PackRef>(isPackRef, {
  message:
    'Expected a reference to a record key ("pro-coastal") or "packId:key"; references never use display names',
});

/**
 * A list of references with no repeats, such as a region's `neighbourKeys`. A key is unique within
 * its kind across every loaded pack, so `jack-marlow` and `example-world:jack-marlow` name the same
 * record and count as a repeat.
 */
export const refListSchema = z.array(refSchema).superRefine((refs, context) => {
  const seen = new Set<string>();
  refs.forEach((ref, index) => {
    const { key } = parseRef(ref);
    if (seen.has(key)) {
      context.addIssue({ code: 'custom', message: `Duplicate reference ${ref}`, path: [index] });
    }
    seen.add(key);
  });
});

/** A reference split into its parts. `packId` is null for a bare key. */
export interface ParsedRef {
  packId: PackId | null;
  key: PackKey;
}

/** Splits a reference into the pack it names (if any) and the record key. */
export function parseRef(ref: PackRef): ParsedRef {
  const match = PACK_REF_PATTERN.exec(ref);
  const packId = match?.[1];
  const key = match?.[2];
  if (key === undefined || !isPackKey(key)) {
    // Unreachable for a value that passed refSchema; kept so a forged PackRef fails loudly.
    throw new Error(`Not a pack reference: ${ref}`);
  }
  return { packId: packId !== undefined && isPackId(packId) ? packId : null, key };
}

/**
 * Every kind of record a pack can hold, in dependency order: a kind only refers to kinds listed
 * before it, apart from references inside one kind (region neighbours, a promotion's developmental
 * parent). Later epics add kinds (gimmicks, finishes, match stories, random events) by extending
 * this list.
 */
export const RECORD_KINDS = [
  'continent',
  'country',
  'region',
  'nameCulture',
  'countryNameMix',
  'ringNameWords',
  'generationRole',
  'generationStyle',
  'bodyArchetype',
  'bodyModifier',
  'generationProfile',
  'traitIncidence',
  // The injury catalog (WRK6-01): refers to nothing, never becomes an entity.
  'injuryKind',
  'person',
  'promotion',
  'brand',
  'title',
  'venue',
  'network',
  'eventDefinition',
  'deal',
  'employment',
  'team',
  'titleReign',
  // Match and segment catalogs (MTCH1). They refer to no other kind and never become entities.
  'matchType',
  'angleType',
  'method',
  // Finishes (MTCH2): refer to methods and match types, never become entities.
  'finish',
] as const;

export const RecordKindSchema = z.enum(RECORD_KINDS);

export type RecordKind = z.infer<typeof RecordKindSchema>;

/** True when `value` names a record kind. */
export function isRecordKind(value: unknown): value is RecordKind {
  return RECORD_KINDS.some((kind) => kind === value);
}

/**
 * One reference field of a record kind, for the loader's reference check (WLD-02). `path` walks
 * from the record to the reference: a field name steps into that field, `[]` into every element of
 * a list and `{}` onto every key of an object (regional popularity is keyed by region). For
 * example `['coverage', 'regionKeys', '[]']` or `['regionalPop', '{}']`.
 */
export interface RecordReference {
  readonly path: readonly string[];
  readonly target: RecordKind;
}

/** Path step: every element of a list. */
export const EACH_ELEMENT = '[]';
/** Path step: every key of an object. */
export const EACH_KEY = '{}';
