/**
 * Role rating: how good a person is at one job, as a weighted mean of their attributes.
 *
 * Nobody has a stored "overall". A 70-rated referee and a 70-rated wrestler are good at different
 * jobs, so a person gets a rating for every role, worked out on read from the attributes and that
 * role's weights. Every weight is a tunable, and an attribute whose weight is 0 is left out.
 *
 * Design: docs/design/workers.md#role-ratings.
 */

import { startCalc, type Traced } from '../../../core/trace';
import {
  ATTRIBUTE_KEYS,
  type AttributeKey,
  type Attributes,
  type Person,
} from '../../../model/entities/person';
import type { EngineTunables } from '../../tunables';
import { ATTRIBUTE_LABELS, formatNumber } from '../../world/people/labels';
import type { RatingRole } from '../helpers/roles';
import { ratingWeightKey, ROLE_RATINGS_DOC_REF } from '../ratingWeights';

/** What the formula needs to know. */
export interface RoleRatingInputs {
  /** The job the person is being rated for. */
  role: RatingRole;
  attributes: Attributes;
}

/** The roles as a rating's title reads them: "Wrestler rating". */
export const RATING_ROLE_LABELS: Readonly<Record<RatingRole, string>> = {
  wrestler: 'Wrestler',
  manager: 'Manager',
  presenter: 'Presenter',
  announcer: 'Announcer',
  referee: 'Referee',
  producer: 'Producer',
  booker: 'Booker',
};

/** The ends of the rating scale, the same as the attributes it is built from. */
export const ROLE_RATING_MIN = 0;
export const ROLE_RATING_MAX = 100;

export const NO_WEIGHTS_NOTE = 'Every weight for this role is 0, so the rating is 0';
export const OCCASIONAL_WRESTLER_NOTE = 'An occasional wrestler is rated with the wrestler weights';

/** The attributes that count toward `role`, in `ATTRIBUTE_KEYS` order. */
function countedAttributes(role: RatingRole, tunables: EngineTunables): AttributeKey[] {
  return ATTRIBUTE_KEYS.filter((attribute) => tunables.get(ratingWeightKey(role, attribute)) > 0);
}

function rate(
  inputs: RoleRatingInputs,
  tunables: EngineTunables,
  notes: readonly string[],
): Traced<number> {
  const calc = startCalc(`${RATING_ROLE_LABELS[inputs.role]} rating`, 0, {
    unit: 'points',
    docRef: ROLE_RATINGS_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  for (const note of notes) {
    calc.note(note);
  }
  const counted = countedAttributes(inputs.role, tunables);
  if (counted.length === 0) {
    return calc.note(NO_WEIGHTS_NOTE).done();
  }
  let totalWeight = 0;
  for (const attribute of counted) {
    const label = ATTRIBUTE_LABELS[attribute];
    const weight = calc.tunable(
      tunables,
      ratingWeightKey(inputs.role, attribute),
      `${label} weight`,
    );
    const value = inputs.attributes[attribute];
    calc.add(`${label} ${formatNumber(value)} × weight ${formatNumber(weight)}`, value * weight);
    totalWeight += weight;
  }
  return calc
    .divide(`Total weight ${formatNumber(totalWeight)}`, totalWeight)
    .clamp(ROLE_RATING_MIN, ROLE_RATING_MAX)
    .done();
}

/**
 * A person's rating in one role: `Σ(weight × attribute) ÷ Σ weight` over the attributes whose
 * weight is above 0, kept between 0 and 100. Each weight is read from
 * `workers.rating.<role>.<attribute>` and named in the trace. When every weight for the role is 0
 * the rating is 0, with a note saying why.
 *
 * The result is not rounded: rounding here would make sorts unstable and the trace lie by up to
 * half a point. Screens round what they show.
 */
export function roleRating(
  inputs: RoleRatingInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  return rate(inputs, deps.tunables, []);
}

/** What the person-level helpers read from a person row. */
type RatedPerson = Pick<Person, 'attributes' | 'roles'>;

/** True for someone who wrestles only occasionally and holds no full wrestler role. */
function isOnlyOccasionalWrestler(person: RatedPerson): boolean {
  return person.roles.includes('occasionalWrestler') && !person.roles.includes('wrestler');
}

/**
 * A person's rating in `role`. An occasional wrestler's wrestler rating uses the wrestler weights,
 * and the trace says so.
 */
export function overallOf(
  person: RatedPerson,
  role: RatingRole,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const notes =
    role === 'wrestler' && isOnlyOccasionalWrestler(person) ? [OCCASIONAL_WRESTLER_NOTE] : [];
  return rate({ role, attributes: person.attributes }, deps.tunables, notes);
}

/** A person's rating in every role. Screens show the main role's by default. */
export function overallByRole(
  person: RatedPerson,
  deps: { tunables: EngineTunables },
): Record<RatingRole, Traced<number>> {
  const rating = (role: RatingRole): Traced<number> => overallOf(person, role, deps);
  return {
    wrestler: rating('wrestler'),
    manager: rating('manager'),
    presenter: rating('presenter'),
    announcer: rating('announcer'),
    referee: rating('referee'),
    producer: rating('producer'),
    booker: rating('booker'),
  };
}
