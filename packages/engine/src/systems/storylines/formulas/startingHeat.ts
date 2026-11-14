/**
 * Starting heat (CRTV3-02): how hot a new storyline is on the day it starts.
 *
 * A base every storyline gets, plus some star power from its two best-known members, capped and
 * kept on the 0–100 scale. Every storyline starts through this formula, whoever creates it.
 *
 * Design: docs/design/storylines.md#starting-heat.
 */

import { startCalc } from '../../../core/trace/calc';
import { constantOf, inputOf, traced } from '../../../core/trace/helpers';
import { tunableNode } from '../../../core/trace/tunable-node';
import type { Traced } from '../../../core/trace/types';
import type { PersonId } from '../../../core/ids';
import type { EngineTunables } from '../../tunables';

export const STARTING_HEAT_DOC_REF = 'docs/design/storylines.md#starting-heat';

/** How many of the best-known members count towards star power. */
export const STAR_POWER_MEMBERS = 2;

/** One member, as starting heat sees them. */
export interface StartingHeatMember {
  /** Their ring name, for the trace. */
  readonly name: string;
  /**
   * Who they are, so their popularity line in the Why? links to their profile (CRTV3-05). Left
   * out, the line is plain text.
   */
  readonly personId?: PersonId;
  /**
   * Their popularity in the promotion's home region, 0–100: the caller's
   * `person.regionalPop[promotion.homeRegionId] ?? 0` (sparse records leave out 0).
   */
  readonly homePopularity: number;
}

export interface StartingHeatInputs {
  readonly members: readonly StartingHeatMember[];
}

/** The (up to) two best-known members: highest home popularity first, then name order. */
function bestKnown(members: readonly StartingHeatMember[]): StartingHeatMember[] {
  return [...members]
    .sort(
      (left, right) =>
        right.homePopularity - left.homePopularity || left.name.localeCompare(right.name, 'en'),
    )
    .slice(0, STAR_POWER_MEMBERS);
}

function popularityLabel(member: StartingHeatMember): string {
  return `${member.name}'s home popularity`;
}

/** One member's home popularity as an input, linked to the person when the caller named them. */
function popularityLine(member: StartingHeatMember): Traced<number> {
  return inputOf(
    popularityLabel(member),
    member.homePopularity,
    member.personId === undefined ? undefined : { kind: 'person', id: member.personId },
    'points',
  );
}

/** `startStarWeight × average home popularity of the best two`, or 0 with no members. */
function starPower(
  members: readonly StartingHeatMember[],
  tunables: EngineTunables,
): { label: string; value: Traced<number> } {
  const best = bestKnown(members);
  if (best.length === 0) {
    return { label: 'Star power', value: constantOf('Star power', 0, 'No members yet') };
  }
  const label = `Star power: ${best.map((member) => member.name).join(' and ')}`;
  const [first, ...rest] = best;
  const calc = startCalc(label, first === undefined ? 0 : popularityLine(first), {
    unit: 'points',
  });
  for (const member of rest) {
    calc.add(popularityLabel(member), popularityLine(member));
  }
  calc
    .divide('Average of the best-known members', best.length)
    .multiply(
      'Star power weight',
      calc.tunable(tunables, 'storylines.heat.startStarWeight', 'Star power weight'),
    );
  return { label, value: calc.done() };
}

/**
 * Starting heat: `startBase + startStarWeight × average home popularity of the two best-known
 * members`, no higher than `startMax`, kept within 0–100 and rounded to a whole number. With
 * `startStarWeight` at 0 there is no star line at all.
 */
export function startingHeat(
  inputs: StartingHeatInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(
    'Starting heat',
    traced(
      tunables.get('storylines.heat.startBase'),
      tunableNode(tunables, 'storylines.heat.startBase', 'Base starting heat'),
    ),
    { unit: 'points', docRef: STARTING_HEAT_DOC_REF },
  );
  if (tunables.get('storylines.heat.startStarWeight') === 0) {
    // 0 turns star power off: no star line at all, only the reason why.
    calc.tunable(tunables, 'storylines.heat.startStarWeight', 'Star power weight');
    calc.branch('Star power is turned off', true);
  } else {
    const star = starPower(inputs.members, tunables);
    calc.add(star.label, star.value);
  }
  return calc
    .min(
      'Starting heat cap',
      calc.tunable(tunables, 'storylines.heat.startMax', 'Highest starting heat'),
    )
    .clamp(0, 100)
    .round('round')
    .done();
}
