/**
 * Starting vices. Vices are kept apart from traits (they can be discovered and treated), so each
 * one is its own roll:
 *
 * `chance = min(1, baseChance × (1 + perExperienceYear × yearsSinceDebut))`
 *
 * with `worldgen.vices.alcoholChance` or `worldgen.vices.substancesChance` as the base chance and
 * `worldgen.vices.perExperienceYear` as the experience scale. A hit is stored as `hidden`: nobody
 * has found out yet. A base chance of 0 means nobody starts with that vice, whatever their
 * experience.
 *
 * Draws from the stream, in order: alcohol (1), substances (1), always.
 *
 * Design: docs/design/world-generation.md#vices.
 */

import type { GameDate } from '../../../core/date';
import { rollChance, type RngStream } from '../../../core/rng';
import { inputOf, startCalc, traced, type TraceNode, type Traced } from '../../../core/trace';
import type { Person, Vices } from '../../../model/entities/person';
import { createEngineTunables, type EngineTunables, type TunableKey } from '../../tunables';
import { experienceYearsAt } from './dates';
import { formatNumber } from './labels';

const VICES_DOC_REF = 'world-generation.md#vices';

/** The vices in roll order, with their base chance tunable and trace words. */
const VICE_ROLLS: readonly (readonly [keyof Vices, TunableKey, string])[] = [
  ['alcohol', 'worldgen.vices.alcoholChance', 'Drinking problem'],
  ['substances', 'worldgen.vices.substancesChance', 'Drug problem'],
];

/** What {@link seedVices} reads besides the person and the stream. */
export interface SeedVicesOptions {
  /** Today in the game; experience is counted up to this date. */
  readonly worldDate: GameDate;
  /** Defaults to every engine tunable at its default value. */
  readonly tunables?: EngineTunables;
}

/** The chance of one vice for someone `experienceYears` past their debut, traced. */
export function viceChance(
  baseKey: TunableKey,
  label: string,
  experienceYears: number,
  tunables: EngineTunables,
): Traced<number> {
  const calc = startCalc(`${label} chance`, 0, {
    startLabel: 'Start',
    unit: 'probability',
    docRef: VICES_DOC_REF,
  });
  calc.add('Base chance', calc.tunable(tunables, baseKey));
  const perYear = calc.tunable(tunables, 'worldgen.vices.perExperienceYear');
  return calc
    .multiply(
      'Experience',
      startCalc('Experience factor', 1, { startLabel: 'No experience', unit: 'multiplier' })
        .add(
          'Years since debut',
          perYear * experienceYears,
          `${formatNumber(perYear)} × ${formatNumber(experienceYears)} years`,
        )
        .done(),
    )
    .clamp(0, 1)
    .done();
}

/**
 * Seeds the vices of `person`: each is `hidden` on a hit and `none` otherwise. Pure: the same
 * person, date, tunables and stream state always give the same vices.
 */
export function seedVices(
  person: Person,
  stream: RngStream,
  options: SeedVicesOptions,
): Traced<Vices> {
  const tunables = options.tunables ?? createEngineTunables();
  const experienceYears = experienceYearsAt(person.debutDate, options.worldDate);
  const vices: Vices = { alcohol: 'none', substances: 'none' };
  const steps: TraceNode[] = [
    inputOf('Years since debut', experienceYears, undefined, 'years').trace,
  ];
  for (const [vice, baseKey, label] of VICE_ROLLS) {
    const chance = viceChance(baseKey, label, experienceYears, tunables);
    const roll = rollChance(stream, chance.value, label);
    if (roll.value) {
      vices[vice] = 'hidden';
    }
    steps.push({
      kind: 'input',
      label,
      value: roll.value ? 'hidden' : 'none',
      docRef: VICES_DOC_REF,
      children: [
        chance.trace,
        { kind: 'roll', label: roll.roll.label, value: roll.roll.result, roll: roll.roll },
      ],
    });
  }
  const held = VICE_ROLLS.filter(([vice]) => vices[vice] !== 'none').map(([, , label]) => label);
  return traced(vices, {
    kind: 'input',
    label: 'Vices',
    value: held.length === 0 ? 'none' : `${held.join(', ')} (hidden)`,
    docRef: VICES_DOC_REF,
    children: steps,
  });
}
