/**
 * Ages and dates for a generated person: the age at today's date, a birth date that gives exactly
 * that age, and the debut date.
 *
 * Ages are always measured at the world date the caller passes in, so someone generated in the
 * tenth year of a game is as old as their birth date says on the day they appear.
 *
 * Design: docs/design/world-generation.md#age-and-dates.
 */

import {
  addDays,
  addYears,
  ageInYears,
  diffDays,
  isAfter,
  type GameDate,
} from '../../../core/date';
import { InvalidArgumentError } from '../../../core/errors';
import { rollInt, rollNormal, type RngStream } from '../../../core/rng';
import { inputOf, startCalc, type Traced } from '../../../core/trace';
import type {
  AgeRange,
  CareerStage,
  DebutRule,
} from '../../../persistence/packs/records/generation';
import type { EngineTunables } from '../../tunables';
import { formatNumber, STAGE_LABELS } from './labels';

const AGE_DOC_REF = 'world-generation.md#age-and-dates';

/** Days in a common year: the most days a birthday offset can move back. */
const DAYS_PER_YEAR = 365;

/**
 * The age in whole years: a normal draw around the stage's midpoint with spread `range / 4`,
 * clamped to the stage's ages and rounded. Draws two numbers from `stream`.
 */
export function rollAge(stream: RngStream, stage: CareerStage, range: AgeRange): Traced<number> {
  const midpoint = (range.min + range.max) / 2;
  const spread = (range.max - range.min) / 4;
  const variation = rollNormal(stream, 0, spread, 'Age variation');
  return startCalc('Age', midpoint, {
    startLabel: `Middle of the ${STAGE_LABELS[stage].toLowerCase()} ages (${String(range.min)}-${String(range.max)})`,
    unit: 'years',
    docRef: AGE_DOC_REF,
  })
    .roll(variation.roll)
    .add(
      'Personal variation',
      variation.value,
      `Spread ${formatNumber(spread)} (a quarter of the range)`,
    )
    .clamp(range.min, range.max, 'Kept inside the stage ages')
    .round('round')
    .done();
}

/**
 * A birth date that makes the person exactly `ageYears` old on `worldDate`: back `ageYears` years,
 * then back 0-364 more days. Draws one number from `stream`.
 *
 * @throws InvalidArgumentError if the age check fails, which would be a date helper bug.
 */
export function rollBirthDate(
  stream: RngStream,
  worldDate: GameDate,
  ageYears: number,
): Traced<GameDate> {
  const offset = rollInt(stream, 0, DAYS_PER_YEAR - 1, 'Days since their last birthday');
  const birthDate = addDays(addYears(worldDate, -ageYears), -offset.value);
  if (ageInYears(birthDate, worldDate) !== ageYears) {
    throw new InvalidArgumentError(
      'rollBirthDate',
      'birthDate',
      birthDate,
      `a date that makes the person ${String(ageYears)} on ${worldDate}`,
    );
  }
  const node = inputOf('Birth date', birthDate).trace;
  return {
    value: birthDate,
    trace: {
      ...node,
      children: [
        { kind: 'roll', label: offset.roll.label, value: offset.roll.result, roll: offset.roll },
        {
          kind: 'note',
          label: `${String(ageYears)} on ${worldDate}, ${String(offset.value)} days after their birthday`,
          value: null,
        },
      ],
    },
  };
}

/**
 * The first day on which someone born on `birthDate` is `years` old by `ageInYears`. For a 29
 * February birthday in a common year, `addYears` lands on 28 February, a day before `ageInYears`
 * counts the birthday (1 March), so the day after is used instead.
 */
export function birthdayAt(birthDate: GameDate, years: number): GameDate {
  const anniversary = addYears(birthDate, years);
  return ageInYears(birthDate, anniversary) < years ? addDays(anniversary, 1) : anniversary;
}

/**
 * Age in years with the fraction of the year since the last birthday: whole years by
 * `ageInYears`, plus the days since the last birthday over the days between that birthday and the
 * next. It rises smoothly through the year and is exactly the whole age on the birthday, so a
 * person born on 2000-06-01 is 30 on 2030-06-01 and 29.997 the day before. It differs from
 * `diffDays / 365.25` by at most a day's worth.
 */
export function exactAge(birthDate: GameDate, date: GameDate): number {
  const wholeYears = ageInYears(birthDate, date);
  const lastBirthday = birthdayAt(birthDate, wholeYears);
  const nextBirthday = birthdayAt(birthDate, wholeYears + 1);
  return wholeYears + diffDays(lastBirthday, date) / diffDays(lastBirthday, nextBirthday);
}

/**
 * Years since `debutDate` on `date`, as a fraction; 0 for someone who has not debuted (or whose
 * debut is still ahead).
 */
export function experienceYearsAt(debutDate: GameDate | null, date: GameDate): number {
  if (debutDate === null || isAfter(debutDate, date)) {
    return 0;
  }
  return exactAge(debutDate, date);
}

/** A person's debut: the date, the age they debuted at, and the years since. */
export interface Debut {
  readonly debutDate: GameDate;
  /** Fractional age at debut. */
  readonly debutAge: number;
  /** `ageYears - debutAge`, never negative. */
  readonly experienceYears: number;
}

/**
 * The debut: an age around `worldgen.people.debutAgeMean` with the role's spread, kept inside the
 * role's limits and never later than the current age. Draws two numbers from `stream`.
 *
 * The date is the birthday at the whole debut age plus the fraction of a year in days, so it is
 * never before the birthday at `rule.minAge`; it is never after `worldDate`.
 */
export function rollDebut(
  stream: RngStream,
  rule: DebutRule,
  tunables: EngineTunables,
  ageYears: number,
  birthDate: GameDate,
  worldDate: GameDate,
): Traced<Debut> {
  const calc = startCalc('Debut age', 0, {
    startLabel: 'Start',
    unit: 'years',
    docRef: AGE_DOC_REF,
  });
  calc.add('Average debut age', calc.tunable(tunables, 'worldgen.people.debutAgeMean'));
  const variation = rollNormal(stream, 0, rule.ageSd, 'Debut age variation');
  calc
    .roll(variation.roll)
    .add('Personal variation', variation.value, `Spread ${formatNumber(rule.ageSd)}`)
    .clamp(rule.minAge, rule.maxAge, "Kept inside the role's debut ages")
    .min('Not later than their current age', ageYears);
  const debutAge = calc.current;
  const wholeYears = Math.floor(debutAge);
  const extraDays = Math.floor((debutAge - wholeYears) * DAYS_PER_YEAR);
  const onTime = addDays(birthdayAt(birthDate, wholeYears), extraDays);
  const debutDate = isAfter(onTime, worldDate) ? worldDate : onTime;
  calc.note(`Debuted on ${debutDate}`);
  const traced = calc.done();
  return {
    value: { debutDate, debutAge, experienceYears: Math.max(0, ageYears - debutAge) },
    trace: traced.trace,
  };
}
