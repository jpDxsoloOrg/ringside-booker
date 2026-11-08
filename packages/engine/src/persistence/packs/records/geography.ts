/**
 * Geography records: continents, countries and regions (design decision D-03).
 *
 * Field names follow the engine's geography entities, with each `<thing>Id` written as
 * `<thing>Key`. Codes, populations and the 0-100 scales use the same ranges as the entities.
 */

import { z } from 'zod';
import { LOCATION_CODE_PATTERN } from '../../../model/entities/geography';
import { PromotionStyleSchema } from '../../../model/entities/promotion-style';
import { zNonNegativeInt } from '../../../model/primitives';
import { defineRecordKind, percentSchema } from '../fields';
import { keySchema, parseRef, refListSchema, refSchema } from '../keys';

const locationCodeSchema = z
  .string()
  .regex(LOCATION_CODE_PATTERN, 'Expected a code of two or three uppercase letters');

export const continentRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    name: z.string().min(1).max(40),
    /** Two or three uppercase letters, unique across continents. */
    code: locationCodeSchema,
  }),
);

export const countryRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    name: z.string().min(1).max(60),
    /** Two or three uppercase letters, unique across countries. */
    code: locationCodeSchema,
    continentKey: refSchema,
    population: zNonNegativeInt,
    /** How much people here care about wrestling, 0-100. */
    wrestlingInterest: percentSchema,
    /** Purchasing power, 0-100; 50 is the reference economy that prices are set for. */
    economy: percentSchema,
    /** The style audiences here like best, or null for no preference. */
    preferredStyle: PromotionStyleSchema.nullable(),
  }),
);

export const regionRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    name: z.string().min(1).max(60),
    countryKey: refSchema,
    population: zNonNegativeInt,
    /** 0-100. Left out = the country's value, copied in by the loader. */
    wrestlingInterest: percentSchema.optional(),
    /** Left out = the country's preferred style. Null = no preference. */
    preferredStyle: PromotionStyleSchema.nullable().optional(),
    /** Bordering regions. Adjacency must be mutual; the loader checks that across packs. */
    neighbourKeys: refListSchema,
  }),
  (region, context) => {
    region.neighbourKeys.forEach((neighbourRef, index) => {
      if (parseRef(neighbourRef).key === region.key) {
        context.addIssue({
          code: 'custom',
          message: 'A region cannot be its own neighbour',
          path: ['neighbourKeys', index],
        });
      }
    });
  },
);

export type ContinentRecord = z.output<typeof continentRecord.full>;
export type CountryRecord = z.output<typeof countryRecord.full>;
export type RegionRecord = z.output<typeof regionRecord.full>;
