/**
 * Data packs: the authoring format every shipped and modded piece of world content is written in.
 *
 * A pack is a folder with a manifest (`pack.json`) and one JSON file per record kind, each file an
 * array of records. The schemas describe and check that format (WLD-01); the loader (WLD-02) turns
 * a set of packs into a World: `resolvePacks` → `mergeRecords` → `checkReferences` →
 * `materialiseWorld`, or all of it in one call with `loadWorldFromPacks`.
 *
 * Format doc: docs/design/data-packs.md.
 */

import { z } from 'zod';
import { formatPath } from '../../core/json';
import type { RecordKind } from './keys';
import type { PackManifest } from './manifest';
import {
  angleTypeRecord,
  matchTypeRecord,
  methodRecord,
  type AngleTypeRecord,
  type MatchTypeRecord,
  type MethodRecord,
} from './records/catalogs';
import {
  continentRecord,
  countryRecord,
  regionRecord,
  type ContinentRecord,
  type CountryRecord,
  type RegionRecord,
} from './records/geography';
import {
  bodyArchetypeRecord,
  bodyModifierRecord,
  generationProfileRecord,
  generationRoleRecord,
  generationStyleRecord,
  traitIncidenceRecord,
  type BodyArchetypeRecord,
  type BodyModifierRecord,
  type GenerationProfileRecord,
  type GenerationRoleRecord,
  type GenerationStyleRecord,
  type TraitIncidenceRecord,
} from './records/generation';
import {
  countryNameMixRecord,
  nameCultureRecord,
  ringNameWordsRecord,
  type CountryNameMixRecord,
  type NameCultureRecord,
  type RingNameWordsRecord,
} from './records/names';
import {
  brandRecord,
  dealRecord,
  eventDefinitionRecord,
  networkRecord,
  promotionRecord,
  titleRecord,
  venueRecord,
  type BrandRecord,
  type DealRecord,
  type EventDefinitionRecord,
  type NetworkRecord,
  type PromotionRecord,
  type TitleRecord,
  type VenueRecord,
} from './records/organisations';
import {
  employmentRecord,
  personRecord,
  teamRecord,
  titleReignRecord,
  type EmploymentRecord,
  type PersonRecord,
  type TeamRecord,
  type TitleReignRecord,
} from './records/people';

export * from './fields';
export * from './issues';
export * from './keys';
export * from './library';
export * from './load';
export * from './manifest';
export * from './materialise';
export * from './merge';
export * from './migrations';
export * from './references';
export * from './resolve';
export * from './semver';
export * from './records/catalogs';
export * from './records/generation';
export * from './records/geography';
export * from './records/names';
export * from './records/organisations';
export * from './records/people';

/** A pack as read from disk, before any checks: the manifest and each record file's raw JSON. */
export interface RawPack {
  manifest: PackManifest;
  files: Partial<Record<RecordKind, unknown>>;
}

/** Every record kind's builder (`full`, `patch`, `remove`, `entry` schemas). */
export const recordKinds = {
  continent: continentRecord,
  country: countryRecord,
  region: regionRecord,
  nameCulture: nameCultureRecord,
  countryNameMix: countryNameMixRecord,
  ringNameWords: ringNameWordsRecord,
  generationRole: generationRoleRecord,
  generationStyle: generationStyleRecord,
  bodyArchetype: bodyArchetypeRecord,
  bodyModifier: bodyModifierRecord,
  generationProfile: generationProfileRecord,
  traitIncidence: traitIncidenceRecord,
  person: personRecord,
  promotion: promotionRecord,
  brand: brandRecord,
  title: titleRecord,
  venue: venueRecord,
  network: networkRecord,
  eventDefinition: eventDefinitionRecord,
  deal: dealRecord,
  employment: employmentRecord,
  team: teamRecord,
  titleReign: titleReignRecord,
  matchType: matchTypeRecord,
  angleType: angleTypeRecord,
  method: methodRecord,
} as const satisfies Record<RecordKind, { entry: z.ZodType }>;

type RecordKindBuilders = typeof recordKinds;

/** The schema for one element of a pack file of each kind: a full record, a patch or a removal. */
export const recordSchemas = {
  continent: continentRecord.entry,
  country: countryRecord.entry,
  region: regionRecord.entry,
  nameCulture: nameCultureRecord.entry,
  countryNameMix: countryNameMixRecord.entry,
  ringNameWords: ringNameWordsRecord.entry,
  generationRole: generationRoleRecord.entry,
  generationStyle: generationStyleRecord.entry,
  bodyArchetype: bodyArchetypeRecord.entry,
  bodyModifier: bodyModifierRecord.entry,
  generationProfile: generationProfileRecord.entry,
  traitIncidence: traitIncidenceRecord.entry,
  person: personRecord.entry,
  promotion: promotionRecord.entry,
  brand: brandRecord.entry,
  title: titleRecord.entry,
  venue: venueRecord.entry,
  network: networkRecord.entry,
  eventDefinition: eventDefinitionRecord.entry,
  deal: dealRecord.entry,
  employment: employmentRecord.entry,
  team: teamRecord.entry,
  titleReign: titleReignRecord.entry,
  matchType: matchTypeRecord.entry,
  angleType: angleTypeRecord.entry,
  method: methodRecord.entry,
} as const satisfies Record<RecordKind, z.ZodType>;

/** A complete record of each kind, as written in a pack. */
export interface PackRecords {
  continent: ContinentRecord;
  country: CountryRecord;
  region: RegionRecord;
  nameCulture: NameCultureRecord;
  countryNameMix: CountryNameMixRecord;
  ringNameWords: RingNameWordsRecord;
  generationRole: GenerationRoleRecord;
  generationStyle: GenerationStyleRecord;
  bodyArchetype: BodyArchetypeRecord;
  bodyModifier: BodyModifierRecord;
  generationProfile: GenerationProfileRecord;
  traitIncidence: TraitIncidenceRecord;
  person: PersonRecord;
  promotion: PromotionRecord;
  brand: BrandRecord;
  title: TitleRecord;
  venue: VenueRecord;
  network: NetworkRecord;
  eventDefinition: EventDefinitionRecord;
  deal: DealRecord;
  employment: EmploymentRecord;
  team: TeamRecord;
  titleReign: TitleReignRecord;
  matchType: MatchTypeRecord;
  angleType: AngleTypeRecord;
  method: MethodRecord;
}

/** One element of a pack file of the given kind: a full record, a patch or a removal. */
export type PackRecordEntry<Kind extends RecordKind> = z.output<RecordKindBuilders[Kind]['entry']>;

/**
 * The schema for a whole record file of one kind: an array of entries in which no key appears
 * twice.
 */
export function recordFileSchema<Kind extends RecordKind>(kind: Kind) {
  const entrySchema: RecordKindBuilders[Kind]['entry'] = recordSchemas[kind];
  return z.array(entrySchema).superRefine((entries, context) => {
    const firstIndexByKey = new Map<string, number>();
    entries.forEach((entry, index) => {
      const firstIndex = firstIndexByKey.get(entry.key);
      if (firstIndex !== undefined) {
        context.addIssue({
          code: 'custom',
          message: `Key ${entry.key} is already used by entry ${String(firstIndex)} in this file`,
          path: [index, 'key'],
        });
        return;
      }
      firstIndexByKey.set(entry.key, index);
    });
  });
}

/**
 * Formats a failed parse as one line per problem, such as
 * `base-world/promotions.json[0].homeRegionKey: Expected a reference ...`.
 */
export function describePackIssues(source: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => `${formatPath(source, issue.path)}: ${issue.message}`);
}
