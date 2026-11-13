/**
 * Health records (WRK6-01): the injury catalog.
 *
 * An **injury kind** is one sort of injury a person can pick up: its player-facing label, the body
 * part it hurts, the range of days it keeps someone out, how often it is picked relative to the
 * other kinds, how often the injured person can still work talking segments, and how the minor,
 * moderate and severe outcomes are weighted. It refers to no other kind and never becomes an
 * entity; at new game the merged records are snapshotted into `WorldMeta.catalogs.injuries`, keyed
 * by content key: pack key `sprained-ankle` becomes `injury.sprained-ankle`.
 *
 * Format doc: docs/design/data-packs.md, "Health".
 */

import { z } from 'zod';
import { parseContentKey, type ContentKey } from '../../../core/content-key';
import {
  INJURY_KEY_PREFIX,
  injuryAnglesChanceSchema,
  injuryDaysSchema,
  injuryDescriptionSchema,
  injuryLabelSchema,
  injurySeverityWeightsSchema,
  injuryWeightSchema,
  refineInjuryKind,
  type InjuryKind,
} from '../../../model/catalogs';
import { BodyPartSchema } from '../../../model/entities/person';
import { defineRecordKind } from '../fields';
import { keySchema, type PackKey, type RecordReference } from '../keys';
import type { MergedRecords } from '../merge';

/** The content-key namespace of injury kinds. */
export const INJURY_CONTENT_PREFIX = INJURY_KEY_PREFIX;

/** The content key an injury kind is stored under: `sprained-ankle` → `injury.sprained-ankle`. */
export function injuryContentKey(packKey: PackKey | string): ContentKey {
  return parseContentKey(`${INJURY_CONTENT_PREFIX}.${packKey}`);
}

export const injuryKindRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    /** Player text, 1-60 characters, such as "Sprained ankle". */
    label: injuryLabelSchema,
    /** One of head, neck, back, arms, torso, legs. */
    bodyPart: BodyPartSchema,
    /** Shortest time out in days, 1-730. */
    minDays: injuryDaysSchema,
    /** Longest time out in days, at least `minDays` and at most 730. */
    maxDays: injuryDaysSchema,
    /** How often this kind is picked relative to the others: above 0, at most 100. */
    weight: injuryWeightSchema,
    /** Chance, 0-1, that the injured person can still appear in talking segments. */
    canWorkAnglesChance: injuryAnglesChanceSchema,
    /** Relative weights, 0-100 each and not all 0, of a minor, moderate or severe outcome. */
    severityWeights: injurySeverityWeightsSchema,
    /** Optional notes for modders and tools, at most 300 characters. */
    description: injuryDescriptionSchema.optional(),
  }),
  refineInjuryKind,
);

export type InjuryKindRecord = z.output<typeof injuryKindRecord.full>;

/** An injury kind record as its runtime catalog entry. */
export function toInjuryKind(record: InjuryKindRecord): InjuryKind {
  return {
    key: injuryContentKey(record.key),
    label: record.label,
    bodyPart: record.bodyPart,
    minDays: record.minDays,
    maxDays: record.maxDays,
    weight: record.weight,
    canWorkAnglesChance: record.canWorkAnglesChance,
    severityWeights: { ...record.severityWeights },
    ...(record.description === undefined ? {} : { description: record.description }),
  };
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The injury catalog for `WorldMeta.catalogs.injuries`: every merged injury kind keyed by content
 * key, in key order. Undefined when no pack defines one, so the world simply has no catalog.
 */
export function injuryCatalogFromRecords(
  records: Pick<MergedRecords, 'injuryKind'>,
): Record<string, InjuryKind> | undefined {
  const merged = records.injuryKind;
  if (merged.size === 0) {
    return undefined;
  }
  const catalog: Record<string, InjuryKind> = {};
  for (const key of [...merged.keys()].sort(compareText)) {
    const entry = merged.get(key);
    if (entry !== undefined) {
      const kind = toInjuryKind(entry.record);
      catalog[kind.key] = kind;
    }
  }
  return catalog;
}

/** Body parts are an engine enum, not pack references, so an injury kind refers to nothing. */
export const injuryKindReferences = [] as const satisfies readonly RecordReference[];
