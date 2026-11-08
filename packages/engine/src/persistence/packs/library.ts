/**
 * The content library: pack data that is not part of the World.
 *
 * Name cultures, country name mixes, ring name words and the generation records (roles, styles,
 * body archetypes, body modifiers, profiles, trait incidence) feed the people generator (WLD-05,
 * WLD-06). They are never World entities and never go into a save:
 * a save records only which packs (and versions) it was built from in `WorldMeta.contentPacks`,
 * and the library is rebuilt from those packs on load. That keeps megabytes of name lists out of
 * every save.
 *
 * The library is deep-frozen, so a generator can hold on to it without anyone changing it
 * underneath. References inside it (a name mix's country and cultures) are bare keys, ready to look
 * up in the library itself or in `WorldMeta.contentKeys`.
 */

import type { ContentPackRef } from '../../model/world-meta';
import { isPackRef, parseRef, type PackRef } from './keys';
import type { MergedContent } from './merge';
import type {
  BodyArchetypeRecord,
  BodyModifierRecord,
  GenerationProfileRecord,
  GenerationRoleRecord,
  GenerationStyleRecord,
  TraitIncidenceRecord,
} from './records/generation';
import type { CountryNameMixRecord, NameCultureRecord, RingNameWordsRecord } from './records/names';

export interface ContentLibrary {
  /** The packs the library was built from, in load order. */
  readonly packs: readonly ContentPackRef[];
  readonly nameCultures: Readonly<Record<string, NameCultureRecord>>;
  /** Keyed by country key. */
  readonly countryNameMixes: Readonly<Record<string, CountryNameMixRecord>>;
  readonly ringNameWords: Readonly<Record<string, RingNameWordsRecord>>;
  readonly generationRoles: Readonly<Record<string, GenerationRoleRecord>>;
  readonly generationStyles: Readonly<Record<string, GenerationStyleRecord>>;
  readonly bodyArchetypes: Readonly<Record<string, BodyArchetypeRecord>>;
  readonly bodyModifiers: Readonly<Record<string, BodyModifierRecord>>;
  readonly generationProfiles: Readonly<Record<string, GenerationProfileRecord>>;
  readonly traitIncidence: Readonly<Record<string, TraitIncidenceRecord>>;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    const children: unknown[] = Object.values(value);
    for (const child of children) {
      deepFreeze(child);
    }
  }
  return value;
}

function byKey<Entry>(
  entries: ReadonlyMap<string, { readonly record: Entry }>,
  normalise: (record: Entry) => Entry = (record) => record,
): Record<string, Entry> {
  const result: Record<string, Entry> = {};
  for (const key of [...entries.keys()].sort((left, right) => (left < right ? -1 : 1))) {
    const entry = entries.get(key);
    if (entry !== undefined) {
      result[key] = normalise(entry.record);
    }
  }
  return result;
}

/** A reference reduced to its bare key (`example-world:cormere` → `cormere`). */
function bareRef(ref: PackRef): PackRef {
  const key: string = parseRef(ref).key;
  return isPackRef(key) ? key : ref;
}

/** A name mix with its country and culture references reduced to bare keys. */
function bareMix(mix: CountryNameMixRecord): CountryNameMixRecord {
  return {
    ...mix,
    countryKey: bareRef(mix.countryKey),
    cultures: mix.cultures.map((culture) => ({
      ...culture,
      cultureKey: bareRef(culture.cultureKey),
    })),
  };
}

/** Builds the frozen content library from merged packs. */
export function buildContentLibrary(content: MergedContent): ContentLibrary {
  const { records } = content;
  return deepFreeze({
    packs: content.packs.map((pack) => ({ ...pack })),
    nameCultures: byKey(records.nameCulture),
    countryNameMixes: byKey(records.countryNameMix, bareMix),
    ringNameWords: byKey(records.ringNameWords),
    generationRoles: byKey(records.generationRole),
    generationStyles: byKey(records.generationStyle),
    bodyArchetypes: byKey(records.bodyArchetype),
    bodyModifiers: byKey(records.bodyModifier),
    generationProfiles: byKey(records.generationProfile),
    traitIncidence: byKey(records.traitIncidence),
  });
}
