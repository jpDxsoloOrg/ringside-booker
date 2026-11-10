/**
 * Player-facing words for what a worker profile lists: traits, vices and the three attribute
 * groups. Kept beside the queries that hand them to screens, so every screen uses the same words.
 */

import type { AttributeGroup, TraitKey, Vices } from '../../model/entities/person';

export const ATTRIBUTE_GROUP_LABELS: Readonly<Record<AttributeGroup, string>> = {
  inRing: 'In-ring',
  character: 'Character',
  crew: 'Crew',
};

export const TRAIT_LABELS: Readonly<Record<TraitKey, string>> = {
  fastLearner: 'Fast learner',
  slowLearner: 'Slow learner',
  agesWell: 'Ages well',
  agesBadly: 'Ages badly',
  durable: 'Durable',
  injuryProne: 'Injury prone',
  workhorse: 'Workhorse',
  coaster: 'Coaster',
  bigMatchPerformer: 'Big-match performer',
  shrinksOnBigStage: 'Shrinks on the big stage',
  generousSeller: 'Generous seller',
  poorSeller: 'Poor seller',
  tagSpecialist: 'Tag specialist',
  teacher: 'Teacher',
  improviser: 'Improviser',
  leader: 'Leader',
  professional: 'Professional',
  troublemaker: 'Troublemaker',
  partier: 'Partier',
  prankster: 'Prankster',
  sensitive: 'Sensitive',
  egotist: 'Egotist',
  selfless: 'Selfless',
  loyal: 'Loyal',
  journeyman: 'Journeyman',
  lovesHardcore: 'Loves hardcore',
  refusesHardcore: 'Refuses hardcore',
  lovesComedy: 'Loves comedy',
  refusesComedy: 'Refuses comedy',
  naturalHeel: 'Natural heel',
  naturalFace: 'Natural face',
};

/** The vices a person can have, in display order. */
export const VICE_KINDS = ['alcohol', 'substances'] as const satisfies readonly (keyof Vices)[];
export type ViceKind = (typeof VICE_KINDS)[number];

export const VICE_LABELS: Readonly<Record<ViceKind, string>> = {
  alcohol: 'Alcohol',
  substances: 'Substances',
};
