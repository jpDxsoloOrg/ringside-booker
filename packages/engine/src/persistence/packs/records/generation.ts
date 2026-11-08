/**
 * Generation records: the numbers the people generator (WLD-05, WLD-06) rolls new people from.
 *
 * - A **generation profile** gives, for one role and ring style, the mean and spread of every
 *   attribute and how strongly each attribute follows the person's overall talent. WLD-06 settles
 *   the full shape; the attribute block is keyed by the engine's attribute list, so a misspelt
 *   attribute fails here instead of being ignored.
 * - A **trait incidence** gives the chance that a generated person holds a trait. Which traits
 *   cannot be held together is not pack data: it comes from the engine's `EXCLUSIVE_TRAIT_PAIRS`.
 */

import { z } from 'zod';
import {
  AttributeKeySchema,
  PersonRoleSchema,
  RingStyleSchema,
  TraitKeySchema,
} from '../../../model/entities/person';
import { chanceSchema, defineRecordKind, percentSchema } from '../fields';
import { keySchema, type RecordReference } from '../keys';

/** Largest standard deviation a profile may give an attribute. */
export const ATTRIBUTE_SD_MAX = 50;

/** Range of a role multiplier on a trait's base chance. */
export const ROLE_MULTIPLIER_MAX = 10;

export const attributeDistributionSchema = z.strictObject({
  /** Average value, 0-100. */
  mean: percentSchema,
  /** Standard deviation, 0-50. */
  sd: z.number().min(0).max(ATTRIBUTE_SD_MAX),
  /** How much the attribute follows the person's overall talent: 0 = not at all, 1 = fully. */
  talentWeight: chanceSchema,
});

export const generationProfileRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    label: z.string().min(1).max(60),
    role: PersonRoleSchema,
    /** The ring style this profile is for, or null for non-wrestlers and "any style". */
    style: RingStyleSchema.nullable(),
    /** One entry for every attribute; a missing or unknown attribute is an error. */
    attributes: z.record(AttributeKeySchema, attributeDistributionSchema),
  }),
);

export const traitIncidenceRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    traitKey: TraitKeySchema,
    /** Chance a generated person holds the trait before role multipliers, 0-1. */
    baseChance: chanceSchema,
    /** Multiplies the base chance for people with that role, 0-10. Roles left out use 1. */
    roleMultipliers: z.partialRecord(PersonRoleSchema, z.number().min(0).max(ROLE_MULTIPLIER_MAX)),
    /** Youngest age at which the trait can be rolled. Left out = any age. */
    minAge: z.number().int().min(0).max(100).optional(),
  }),
);

export type AttributeDistribution = z.output<typeof attributeDistributionSchema>;
export type GenerationProfileRecord = z.output<typeof generationProfileRecord.full>;
export type TraitIncidenceRecord = z.output<typeof traitIncidenceRecord.full>;

// ---------------------------------------------------------------------------------------------
// Reference fields, checked by the loader (WLD-02). `traitKey` names an engine trait, not a record.

export const generationProfileReferences = [] as const satisfies readonly RecordReference[];

export const traitIncidenceReferences = [] as const satisfies readonly RecordReference[];
