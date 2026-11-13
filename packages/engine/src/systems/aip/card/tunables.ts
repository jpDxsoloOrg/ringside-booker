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
export const TITLE_PICTURE_DOC_REF = 'rival-booking.md#title-picture';
export const CHALLENGERS_DOC_REF = 'rival-booking.md#challengers';

/** `aip.card.talkShare.<importance>`: the talking share of a show of that importance. */
export type TalkShareKey = `aip.card.talkShare.${EventImportance}`;
/** `aip.titles.maxPerShow.<importance>`: the most title matches on a show of that importance. */
export type TitleCapKey = `aip.titles.maxPerShow.${EventImportance}`;

/** `aip.titles.importanceBonus.<importance>`: urgency a show of that importance adds. */
export type ImportanceBonusKey = `aip.titles.importanceBonus.${EventImportance}`;

export function talkShareKey(importance: EventImportance): TalkShareKey {
  return `aip.card.talkShare.${importance}`;
}

export function titleCapKey(importance: EventImportance): TitleCapKey {
  return `aip.titles.maxPerShow.${importance}`;
}

export function importanceBonusKey(importance: EventImportance): ImportanceBonusKey {
  return `aip.titles.importanceBonus.${importance}`;
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

const IMPORTANCE_BONUS = {
  kind: 'number',
  min: 0,
  max: 5,
  step: 0.25,
  unit: 'points',
  category: RIVAL_BOOKING_CATEGORY,
  docRef: TITLE_PICTURE_DOC_REF,
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

  // Which titles are defended tonight (AIP4-02).
  'aip.titles.defenceIntervalDays': {
    kind: 'number',
    default: 28,
    min: 1,
    max: 365,
    unit: 'days',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Usual gap between defences of a title, for a booker with middling title taste',
    docRef: TITLE_PICTURE_DOC_REF,
  },
  'aip.titles.tempoSwing': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: RIVAL_BOOKING_CATEGORY,
    description:
      "How far the booker's title taste moves the usual gap: at 0.5, taste 100 halves it and taste 0 makes it half as long again",
    docRef: TITLE_PICTURE_DOC_REF,
  },
  'aip.titles.prestigeWeight': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 5,
    step: 0.1,
    unit: 'points',
    category: RIVAL_BOOKING_CATEGORY,
    description:
      'Urgency a title gains per 100 prestige: prestigious titles are defended more often',
    docRef: TITLE_PICTURE_DOC_REF,
  },
  'aip.titles.importanceBonus.house': {
    ...IMPORTANCE_BONUS,
    default: 0,
    description: 'Urgency a house show adds to every title: big shows put more titles on the line',
  },
  'aip.titles.importanceBonus.minor': {
    ...IMPORTANCE_BONUS,
    default: 0,
    description: 'Same, on a minor show',
  },
  'aip.titles.importanceBonus.regular': {
    ...IMPORTANCE_BONUS,
    default: 0,
    description: 'Same, on a regular weekly show',
  },
  'aip.titles.importanceBonus.major': {
    ...IMPORTANCE_BONUS,
    default: 1,
    description: 'Same, on a major show',
  },
  'aip.titles.importanceBonus.flagship': {
    ...IMPORTANCE_BONUS,
    default: 2,
    description: 'Same, on the flagship show of the year',
  },
  'aip.titles.dueThreshold': {
    kind: 'number',
    default: 1,
    min: 0,
    max: 10,
    step: 0.1,
    unit: 'points',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Urgency at which a title is due a defence tonight',
    docRef: TITLE_PICTURE_DOC_REF,
  },
  'aip.titles.recentChallengers': {
    kind: 'integer',
    default: 2,
    min: 0,
    max: 10,
    unit: 'count',
    category: RIVAL_BOOKING_CATEGORY,
    description:
      "How many of a title's latest challengers rest before they challenge again (0 never)",
    docRef: CHALLENGERS_DOC_REF,
  },
  'aip.titles.challengerPool': {
    kind: 'integer',
    default: 3,
    min: 1,
    max: 10,
    unit: 'count',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'How many of the best eligible contenders the booker chooses a challenger from',
    docRef: CHALLENGERS_DOC_REF,
  },
  'aip.titles.excludeOtherChampions': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: RIVAL_BOOKING_CATEGORY,
    description:
      "Whether a champion is kept out of challenging for another of the promotion's titles",
    docRef: CHALLENGERS_DOC_REF,
  },
});
