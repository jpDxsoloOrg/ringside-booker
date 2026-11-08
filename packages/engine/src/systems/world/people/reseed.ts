/**
 * Re-rolling potential for people already in the world: the new-game "re-roll potential" option,
 * which also works on hand-made pack people.
 *
 * Talent is a generation-time value and is never stored, so it is estimated again from the
 * person's attributes: each attribute's z-score against the profile for their main role and the
 * career stage their age fits best, combined with weights from the profile's talent weights (see
 * {@link estimateTalent}). Then {@link seedPotential} runs as it does for a new person, on the
 * current world date, and the new `development` is written through the transaction.
 *
 * Design: docs/design/world-generation.md#re-rolling-potential.
 */

import type { PersonId } from '../../../core/ids';
import type { RngStream } from '../../../core/rng';
import { inputOf, startCalc, type Traced } from '../../../core/trace';
import type { Tx } from '../../../model/tx';
import type { GameTables } from '../../../model/tables';
import { compareIds } from '../../../model/table';
import { ATTRIBUTE_KEYS, type Development, type Person } from '../../../model/entities/person';
import type { GameDate } from '../../../core/date';
import type { ContentLibrary } from '../../../persistence/packs/library';
import { CAREER_STAGES, type CareerStage } from '../../../persistence/packs/records/generation';
import { createEngineTunables, type EngineTunables } from '../../tunables';
import { compiledGenerationOf, type CompiledRole } from './content';
import { exactAge } from './dates';
import { formatNumber, STAGE_LABELS } from './labels';
import { seedPotential } from './potential';

const RESEED_DOC_REF = 'world-generation.md#re-rolling-potential';

/** Talent weights are capped here so an attribute that follows talent fully cannot divide by 0. */
const TALENT_WEIGHT_CAP = 0.95;

/** The estimate is kept within this many standard deviations. */
const TALENT_LIMIT = 3;

/** The career stage whose ages fit `age` best: inside the range, nearest the middle. */
export function stageForAge(role: CompiledRole, age: number): CareerStage {
  let best: CareerStage = CAREER_STAGES[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const stage of CAREER_STAGES) {
    const range = role.record.stageAges[stage];
    const middle = (range.min + range.max) / 2;
    const outside =
      age < range.min ? range.min - age : age > range.max + 1 ? age - range.max - 1 : 0;
    // Being outside a range always loses to being inside one.
    const score = outside * 1000 + Math.abs(age - middle);
    if (score < bestScore) {
      best = stage;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Talent as a z-score, estimated from the attributes. For every attribute the profile ties to
 * talent (`talentWeight` ρ above 0, spread above 0), `z = (value − mean) / sd`; the estimate is
 * `Σ (ρ z / (1 − ρ²)) / Σ (ρ² / (1 − ρ²))`, the weighting that undoes the generator's
 * `ρ × talent + √(1 − ρ²) × noise`. ρ is capped at 0.95 and the result is kept within ±3. Ring
 * style and body modifiers are not taken back out, so it is an estimate, not the original value.
 * A person with no generation role or profile gets 0.
 */
export function estimateTalent(
  person: Person,
  worldDate: GameDate,
  library: ContentLibrary,
): Traced<number> {
  const calc = startCalc('Estimated talent', 0, {
    startLabel: 'Average talent',
    docRef: RESEED_DOC_REF,
  });
  const compiled = compiledGenerationOf(library);
  const role = person.roles
    .map((personRole) => compiled.roles.get(personRole))
    .find((found): found is CompiledRole => found !== undefined);
  if (role === undefined) {
    return calc.note('No generation profile for their roles, so talent counts as average').done();
  }
  const age = exactAge(person.birthDate, worldDate);
  const stage = stageForAge(role, age);
  const profile = role.profiles.get(stage);
  if (profile === undefined) {
    return calc
      .note(
        `No ${STAGE_LABELS[stage].toLowerCase()} profile for ${role.record.label}, so talent counts as average`,
      )
      .done();
  }
  let weightedSum = 0;
  let weightTotal = 0;
  for (const key of ATTRIBUTE_KEYS) {
    const distribution = profile.attributes[key];
    const weight = Math.min(TALENT_WEIGHT_CAP, distribution.talentWeight);
    if (weight <= 0 || distribution.sd <= 0) {
      continue;
    }
    const zScore = (person.attributes[key] - distribution.mean) / distribution.sd;
    const residual = 1 - weight * weight;
    weightedSum += (weight * zScore) / residual;
    weightTotal += (weight * weight) / residual;
  }
  calc.note(
    `Compared with the ${profile.label} profile (age ${formatNumber(age)} fits ${STAGE_LABELS[stage].toLowerCase()} best)`,
  );
  if (weightTotal === 0) {
    return calc
      .note('No attribute in the profile follows talent, so talent counts as average')
      .done();
  }
  return calc
    .add(
      'From their attributes',
      inputOf('Talent-weighted mean of attribute z-scores', weightedSum / weightTotal),
    )
    .clamp(-TALENT_LIMIT, TALENT_LIMIT)
    .done();
}

/** Which people to re-roll. Left out: everyone. */
export interface ReseedFilter {
  readonly personIds?: readonly PersonId[];
}

/** What {@link reseedPotential} reads besides the transaction, filter and stream. */
export interface ReseedOptions {
  /** The content the talent estimate and the role skills come from. */
  readonly library: ContentLibrary;
  /** Defaults to every engine tunable at its default value. */
  readonly tunables?: EngineTunables;
}

/** One re-rolled person: the talent estimate and the new development, with their traces. */
export interface ReseededPerson {
  readonly personId: PersonId;
  readonly talent: Traced<number>;
  readonly development: Traced<Development>;
}

/**
 * Recomputes `development` for the people in `filter.personIds` (or everyone), in ascending ID
 * order, on the world's current date, and writes it through `tx`. Nobody else is touched.
 * Deterministic: the same world, filter, tunables and stream state give the same results.
 *
 * @throws EntityNotFoundError when a requested person is not in the world.
 */
export function reseedPotential(
  tx: Tx<GameTables>,
  filter: ReseedFilter,
  stream: RngStream,
  options: ReseedOptions,
): ReseededPerson[] {
  const tunables = options.tunables ?? createEngineTunables();
  const people = tx.view.tables.people;
  const worldDate = tx.view.meta.currentDate;
  const ids =
    filter.personIds === undefined
      ? [...people.ids()]
      : [...new Set(filter.personIds)].sort(compareIds);
  const results: ReseededPerson[] = [];
  for (const personId of ids) {
    const person = people.require(personId);
    const talent = estimateTalent(person, worldDate, options.library);
    const development = seedPotential(person, talent.value, worldDate, stream, {
      tunables,
      library: options.library,
    });
    tx.update('people', personId, { development: development.value });
    results.push({ personId, talent, development });
  }
  return results;
}
