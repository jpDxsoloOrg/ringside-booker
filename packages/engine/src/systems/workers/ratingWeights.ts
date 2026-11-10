/**
 * Role rating weights: how much each attribute counts toward a person's rating in each role.
 *
 * There is one tunable per role and attribute (`workers.rating.<role>.<attribute>`), 84 in all, so
 * a balance profile can change what makes a good referee without touching code. A weight of 0
 * leaves the attribute out of that role's rating.
 *
 * Design: docs/design/workers.md#role-ratings.
 */

import { TunableDefinitionError, type NumberTunableDef } from '../../core/tunables/define';
import { ATTRIBUTE_KEYS, type AttributeKey } from '../../model/entities/person';
import { ATTRIBUTE_LABELS } from '../world/people/labels';
import { RATING_ROLES, type RatingRole } from './helpers/roles';

/** The tunable key of one role's weight for one attribute. */
export type RatingWeightKey = `workers.rating.${RatingRole}.${AttributeKey}`;

export const RATING_WEIGHTS_CATEGORY = 'Worker ratings';
export const ROLE_RATINGS_DOC_REF = 'workers.md#role-ratings';

const WEIGHT_MIN = 0;
const WEIGHT_MAX = 10;
const WEIGHT_STEP = 0.5;

/** The default weights. An attribute a role does not list counts for nothing (weight 0). */
export const DEFAULT_RATING_WEIGHTS: Readonly<
  Record<RatingRole, Readonly<Partial<Record<AttributeKey, number>>>>
> = {
  wrestler: {
    ringwork: 3,
    psychology: 2,
    athleticism: 1.5,
    charisma: 1.5,
    stamina: 1,
    safety: 1,
    mic: 1,
    presence: 1,
  },
  manager: { mic: 3, charisma: 2, presence: 1.5, psychology: 1 },
  presenter: { mic: 2, charisma: 2, presence: 2, broadcasting: 1 },
  announcer: { broadcasting: 3, mic: 1.5, psychology: 1, charisma: 0.5 },
  referee: { officiating: 4, psychology: 1, stamina: 0.5 },
  producer: { producing: 4, psychology: 2, booking: 1 },
  booker: { booking: 4, psychology: 1.5, producing: 1 },
};

/** The key of `role`'s weight for `attribute`. */
export function ratingWeightKey(role: RatingRole, attribute: AttributeKey): RatingWeightKey {
  return `workers.rating.${role}.${attribute}`;
}

/** True when `definitions` holds a weight for every role and attribute. */
function holdsEveryWeight(
  definitions: Readonly<Record<string, NumberTunableDef>>,
): definitions is Record<RatingWeightKey, NumberTunableDef> {
  return RATING_ROLES.every((role) =>
    ATTRIBUTE_KEYS.every((attribute) =>
      Object.hasOwn(definitions, ratingWeightKey(role, attribute)),
    ),
  );
}

/** One weight tunable for every role and attribute, in role then attribute order. */
export function ratingWeightTunables(): Record<RatingWeightKey, NumberTunableDef> {
  const definitions: Record<string, NumberTunableDef> = {};
  for (const role of RATING_ROLES) {
    for (const attribute of ATTRIBUTE_KEYS) {
      definitions[ratingWeightKey(role, attribute)] = {
        kind: 'number',
        default: DEFAULT_RATING_WEIGHTS[role][attribute] ?? 0,
        min: WEIGHT_MIN,
        max: WEIGHT_MAX,
        step: WEIGHT_STEP,
        unit: 'ratio',
        category: RATING_WEIGHTS_CATEGORY,
        description: `How much ${ATTRIBUTE_LABELS[attribute]} counts toward a ${role}'s rating`,
        docRef: ROLE_RATINGS_DOC_REF,
      };
    }
  }
  // The loops fill in every key; the check is what tells the compiler so.
  if (!holdsEveryWeight(definitions)) {
    throw new TunableDefinitionError(['workers.rating: a role and attribute pair has no weight']);
  }
  return definitions;
}
