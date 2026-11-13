/**
 * The card planner's balance numbers (AIP4): who a rival show may use, how many of its main-card
 * slots are talking segments and how many title matches it may hold. Category `Rival booking`,
 * each with a docRef into docs/design/rival-booking.md.
 *
 * Every key is about slots, people and counts; nothing here sets a segment's length (D-10).
 * Later AIP4 tickets append their keys to this same set.
 */

import { defineTunables } from '../../../core/tunables/define';
import type { EventImportance } from '../../../model/entities/event-definition';

export const RIVAL_BOOKING_CATEGORY = 'Rival booking';
export const CARD_POOL_DOC_REF = 'rival-booking.md#card-pool';
export const CARD_SHAPE_DOC_REF = 'rival-booking.md#card-shape';
export const TITLE_CAP_DOC_REF = 'rival-booking.md#title-matches';

/** `aip.card.talkShare.<importance>`: the talking share of a show of that importance. */
export type TalkShareKey = `aip.card.talkShare.${EventImportance}`;
/** `aip.titles.maxPerShow.<importance>`: the most title matches on a show of that importance. */
export type TitleCapKey = `aip.titles.maxPerShow.${EventImportance}`;

export function talkShareKey(importance: EventImportance): TalkShareKey {
  return `aip.card.talkShare.${importance}`;
}

export function titleCapKey(importance: EventImportance): TitleCapKey {
  return `aip.titles.maxPerShow.${importance}`;
}

const TALK_SHARE = {
  kind: 'number',
  min: 0,
  max: 1,
  step: 0.05,
  unit: 'ratio',
  category: RIVAL_BOOKING_CATEGORY,
  docRef: CARD_SHAPE_DOC_REF,
} as const;

const TITLE_CAP = {
  kind: 'integer',
  min: 0,
  max: 12,
  unit: 'count',
  category: RIVAL_BOOKING_CATEGORY,
  docRef: TITLE_CAP_DOC_REF,
} as const;

export const aipCardTunables = defineTunables({
  // The card pool.
  'aip.card.maxFatigue': {
    kind: 'number',
    default: 75,
    min: 0,
    max: 100,
    unit: 'points',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Fatigue above which a rival only books a worker as a last resort',
    docRef: CARD_POOL_DOC_REF,
  },
  'aip.card.minWorkers': {
    kind: 'integer',
    default: 5,
    min: 0,
    max: 30,
    unit: 'count',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'A rival cancels a show with fewer wrestlers fit to work than this (0 never)',
    docRef: CARD_POOL_DOC_REF,
  },
  'aip.card.mixedGender': {
    kind: 'boolean',
    default: false,
    unit: 'flag',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Whether a rival may book men and women against each other outside title matches',
    docRef: CARD_POOL_DOC_REF,
  },

  // The card shape.
  'aip.card.talkShare.house': {
    ...TALK_SHARE,
    default: 0,
    description: 'Share of main-card slots a rival gives to talking segments on a house show',
  },
  'aip.card.talkShare.minor': {
    ...TALK_SHARE,
    default: 0.15,
    description: 'Same, on a minor show',
  },
  'aip.card.talkShare.regular': {
    ...TALK_SHARE,
    default: 0.3,
    description: 'Same, on a regular weekly show',
  },
  'aip.card.talkShare.major': {
    ...TALK_SHARE,
    default: 0.2,
    description: 'Same, on a major show',
  },
  'aip.card.talkShare.flagship': {
    ...TALK_SHARE,
    default: 0.15,
    description: 'Same, on the flagship show of the year',
  },
  'aip.card.talkTasteSwing': {
    ...TALK_SHARE,
    default: 0.5,
    description:
      "How far the booker's taste for talking moves the share: at 1, taste 100 doubles it and taste 0 removes it",
  },
  'aip.card.maxTalkShare': {
    ...TALK_SHARE,
    default: 0.5,
    description: 'The largest share of main-card slots a rival ever gives to talking segments',
  },
  'aip.card.fillPreShow': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: RIVAL_BOOKING_CATEGORY,
    description: "Whether a rival fills its shows' pre-show slots",
    docRef: CARD_SHAPE_DOC_REF,
  },

  // How many title matches a card may hold.
  'aip.titles.maxPerShow.house': {
    ...TITLE_CAP,
    default: 1,
    description: 'Most title matches a rival books on a house show',
  },
  'aip.titles.maxPerShow.minor': {
    ...TITLE_CAP,
    default: 1,
    description: 'Same, on a minor show',
  },
  'aip.titles.maxPerShow.regular': {
    ...TITLE_CAP,
    default: 2,
    description: 'Same, on a regular weekly show',
  },
  'aip.titles.maxPerShow.major': {
    ...TITLE_CAP,
    default: 4,
    description: 'Same, on a major show',
  },
  'aip.titles.maxPerShow.flagship': {
    ...TITLE_CAP,
    default: 6,
    description: 'Same, on the flagship show of the year',
  },
});
