/**
 * People builder.
 *
 * Default person: a 28-year-old (on `TEST_START_DATE`) active wrestler who debuted at 18, every
 * attribute at 50, condition 100 everywhere, no fatigue, injury, restrictions, traits, vices or
 * regional popularity, born and based in `reg_0000000001`, named `Test Person 001`, `002`, ...
 */

import { addYears } from '../../../src/core/date';
import {
  PersonSchema,
  type Attributes,
  type BodyCondition,
  type Person,
} from '../../../src/model/entities/person';
import { TestIds, testId, type TestIdSequence } from '../ids';
import { buildRow, placeholderName, TEST_START_DATE, type DeepPartial } from './build-row';

export const DEFAULT_ATTRIBUTE = 50;
export const DEFAULT_CONDITION = 100;
export const DEFAULT_PERSON_AGE = 28;
export const DEFAULT_DEBUT_AGE = 18;

/** Every attribute at `value`. */
export function flatAttributes(value: number): Attributes {
  return {
    ringwork: value,
    psychology: value,
    stamina: value,
    safety: value,
    athleticism: value,
    mic: value,
    charisma: value,
    presence: value,
    officiating: value,
    broadcasting: value,
    producing: value,
    booking: value,
  };
}

/** Every body part at `value`. */
export function flatCondition(value: number): BodyCondition {
  return { head: value, neck: value, back: value, arms: value, torso: value, legs: value };
}

/** A person row. `sequence` supplies the ID and the placeholder number when they are not given. */
export function aPerson(
  overrides: DeepPartial<Person> = {},
  sequence: TestIdSequence = TestIds,
): Person {
  const needsName =
    overrides.givenName === undefined ||
    overrides.familyName === undefined ||
    overrides.defaultRingName === undefined;
  const name = placeholderName('Person', needsName ? sequence.nextNumber('person') : 0);
  const birthDate = overrides.birthDate ?? addYears(TEST_START_DATE, -DEFAULT_PERSON_AGE);
  const homeRegionId = testId('region');
  const defaults: Person = {
    id: overrides.id ?? sequence.id('person'),
    givenName: 'Test',
    familyName: name.slice('Test '.length),
    defaultRingName: name,
    gender: 'male',
    birthDate,
    // Follows an overridden birth date, so a younger or older person still debuts at 18.
    debutDate: addYears(birthDate, DEFAULT_DEBUT_AGE),
    birthRegionId: homeRegionId,
    basedInRegionId: homeRegionId,
    imageRef: null,
    masked: false,
    tags: [],
    roles: ['wrestler'],
    status: 'active',
    career: { canOwn: false, canBook: false },
    motivation: 'money',
    heightCm: 183,
    weightKg: 100,
    build: 'athletic',
    style: 'allRounder',
    attributes: flatAttributes(DEFAULT_ATTRIBUTE),
    condition: flatCondition(DEFAULT_CONDITION),
    fatigue: 0,
    injury: null,
    restrictions: [],
    development: { potential: 0, ceilings: {} },
    regionalPop: {},
    traits: [],
    vices: { alcohol: 'none', substances: 'none' },
  };
  return buildRow(PersonSchema, 'aPerson', defaults, overrides);
}
