/**
 * Builders for continents, countries, regions and venues.
 *
 * References default to the first row of each kind. Defaults:
 *
 * - continent `Test Continent 001`, code `TCA`, `TCB`, ...;
 * - country `Test Country 001`, code `TNA`, `TNB`, ...: population 1,000,000, interest and
 *   economy 50, no preferred style, on `ctn_0000000001`;
 * - region `Test Region 001`: population 250,000, interest 50, no preferred style and no
 *   neighbours, in `cty_0000000001`;
 * - venue `Test Venue 001`: a 2,000-seat hall in `reg_0000000001`, always open, open to anyone.
 */

import {
  ContinentSchema,
  CountrySchema,
  RegionSchema,
} from '../../../src/model/entities/geography';
import type { Continent, Country, Region } from '../../../src/model/entities/geography';
import { VenueSchema, type Venue } from '../../../src/model/entities/venue';
import { TestIds, testId, type TestIdSequence } from '../ids';
import { buildRow, placeholderLetters, placeholderName, type DeepPartial } from './build-row';

export function aContinent(
  overrides: DeepPartial<Continent> = {},
  sequence: TestIdSequence = TestIds,
): Continent {
  const number = sequence.nextNumber('continent');
  const defaults: Continent = {
    id: overrides.id ?? sequence.id('continent'),
    name: placeholderName('Continent', number),
    code: `TC${placeholderLetters(number)}`,
  };
  return buildRow(ContinentSchema, 'aContinent', defaults, overrides);
}

export function aCountry(
  overrides: DeepPartial<Country> = {},
  sequence: TestIdSequence = TestIds,
): Country {
  const number = sequence.nextNumber('country');
  const defaults: Country = {
    id: overrides.id ?? sequence.id('country'),
    continentId: testId('continent'),
    name: placeholderName('Country', number),
    code: `TN${placeholderLetters(number)}`,
    population: 1_000_000,
    wrestlingInterest: 50,
    economy: 50,
    preferredStyle: null,
  };
  return buildRow(CountrySchema, 'aCountry', defaults, overrides);
}

export function aRegion(
  overrides: DeepPartial<Region> = {},
  sequence: TestIdSequence = TestIds,
): Region {
  const defaults: Region = {
    id: overrides.id ?? sequence.id('region'),
    countryId: testId('country'),
    name: overrides.name ?? placeholderName('Region', sequence.nextNumber('region')),
    population: 250_000,
    wrestlingInterest: 50,
    preferredStyle: null,
    neighbourRegionIds: [],
  };
  return buildRow(RegionSchema, 'aRegion', defaults, overrides);
}

export function aVenue(
  overrides: DeepPartial<Venue> = {},
  sequence: TestIdSequence = TestIds,
): Venue {
  const defaults: Venue = {
    id: overrides.id ?? sequence.id('venue'),
    name: overrides.name ?? placeholderName('Venue', sequence.nextNumber('venue')),
    regionId: testId('region'),
    capacity: 2000,
    kind: 'hall',
    openedOn: null,
    closedOn: null,
    exclusivePromotionId: null,
    imageRef: null,
  };
  return buildRow(VenueSchema, 'aVenue', defaults, overrides);
}
