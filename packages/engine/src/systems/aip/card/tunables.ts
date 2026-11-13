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
export const FILLING_DOC_REF = 'rival-booking.md#filling-the-card';
export const MATCH_TYPES_DOC_REF = 'rival-booking.md#match-types';
export const FALLBACK_DOC_REF = 'rival-booking.md#fallback-chain';
export const TALKING_DOC_REF = 'rival-booking.md#talking-segments';
export const STORYLINES_DOC_REF = 'rival-booking.md#storylines';
export const CARD_SCORE_DOC_REF = 'rival-booking.md#card-score';
export const ORDERING_DOC_REF = 'rival-booking.md#ordering';
export const PLAN_CARD_DOC_REF = 'rival-booking.md#planning-a-card';
export const SHOW_DAY_DOC_REF = 'rival-booking.md#show-day';

/** The shapes of match the card planner weighs against each other (`formulas/matchTypeWeight.ts`). */
export const MATCH_FAMILIES = ['oneOnOne', 'tag', 'trios', 'multiWay', 'other'] as const;
export type MatchFamily = (typeof MATCH_FAMILIES)[number];

/** `aip.card.typeWeight.<family>`: the base weight of a match type of that family. */
export type TypeWeightKey = `aip.card.typeWeight.${MatchFamily}`;

export function typeWeightKey(family: MatchFamily): TypeWeightKey {
  return `aip.card.typeWeight.${family}`;
}

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

const TYPE_WEIGHT = {
  kind: 'number',
  min: 0,
  max: 1000,
  unit: 'points',
  category: RIVAL_BOOKING_CATEGORY,
  docRef: MATCH_TYPES_DOC_REF,
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
  'aip.card.keepDetailDays': {
    kind: 'integer',
    default: 28,
    min: 0,
    max: 3650,
    unit: 'days',
    category: RIVAL_BOOKING_CATEGORY,
    description:
      "How many days a rival show's per-slot Why? is kept in full; after that only a summary is kept",
    docRef: SHOW_DAY_DOC_REF,
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

  // Filling the card (AIP4-03).
  'aip.card.maxStorylineSegments': {
    kind: 'integer',
    default: 2,
    min: 0,
    max: 6,
    unit: 'count',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Most storyline segments a rival puts on one show',
    docRef: STORYLINES_DOC_REF,
  },
  'aip.card.storylineMinHeat': {
    kind: 'number',
    default: 0,
    min: 0,
    max: 100,
    unit: 'points',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Heat a storyline needs before a rival gives it a segment (0: every active one)',
    docRef: STORYLINES_DOC_REF,
  },
  'aip.card.storylineMatchChance': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'probability',
    category: RIVAL_BOOKING_CATEGORY,
    description:
      'Chance a storyline with a fit face and heel gets a match rather than a talking segment',
    docRef: STORYLINES_DOC_REF,
  },
  'aip.card.typeWeight.oneOnOne': {
    ...TYPE_WEIGHT,
    default: 100,
    description: 'How often a rival picks a one-on-one match type, against the other kinds',
  },
  'aip.card.typeWeight.tag': {
    ...TYPE_WEIGHT,
    default: 35,
    description: 'Same, for a two-on-two tag match type',
  },
  'aip.card.typeWeight.multiWay': {
    ...TYPE_WEIGHT,
    default: 10,
    description: 'Same, for a match of three or more singles sides (three-way, four-way)',
  },
  'aip.card.typeWeight.trios': {
    ...TYPE_WEIGHT,
    default: 6,
    description: 'Same, for a three-on-three match type',
  },
  'aip.card.typeWeight.other': {
    ...TYPE_WEIGHT,
    default: 2,
    description: 'Same, for any other shape, such as a handicap match or a battle royal',
  },
  'aip.card.variantShare': {
    kind: 'number',
    default: 0.2,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: RIVAL_BOOKING_CATEGORY,
    description:
      "Share of a family's weight its variants split (endurance and sprint for one-on-one); the plain type keeps the rest",
    docRef: MATCH_TYPES_DOC_REF,
  },
  'aip.card.poolComfort': {
    kind: 'number',
    default: 2,
    min: 1,
    max: 5,
    step: 0.25,
    unit: 'multiplier',
    category: RIVAL_BOOKING_CATEGORY,
    description:
      'How many times the wrestlers a match needs must be free before its type gets its full weight',
    docRef: MATCH_TYPES_DOC_REF,
  },
  'aip.card.noTeamFactor': {
    kind: 'number',
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'multiplier',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Weight left to a tag or trios match type when fewer than two teams are free',
    docRef: MATCH_TYPES_DOC_REF,
  },
  'aip.card.pickWindow': {
    kind: 'integer',
    default: 5,
    min: 1,
    max: 20,
    unit: 'count',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'How many of the best free workers a rival chooses each place on the card from',
    docRef: FALLBACK_DOC_REF,
  },
  'aip.card.secondSpeakerChance': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'probability',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Chance a talking segment gets a second speaker',
    docRef: TALKING_DOC_REF,
  },

  // Ordering the card (AIP4-04).
  'aip.card.order.titleWeight': {
    kind: 'number',
    default: 0.3,
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'points',
    category: RIVAL_BOOKING_CATEGORY,
    description: "Card score a title on the line adds per point of the title's prestige",
    docRef: CARD_SCORE_DOC_REF,
  },
  'aip.card.order.heatWeight': {
    kind: 'number',
    default: 0.2,
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'points',
    category: RIVAL_BOOKING_CATEGORY,
    description:
      "Card score a storyline adds per point of the story's heat (the hottest one counts)",
    docRef: CARD_SCORE_DOC_REF,
  },
  'aip.card.order.aceBoost': {
    kind: 'number',
    default: 12,
    min: 0,
    max: 50,
    unit: 'points',
    category: RIVAL_BOOKING_CATEGORY,
    description: "Card score added to a segment with the promotion's ace in it",
    docRef: CARD_SCORE_DOC_REF,
  },
  'aip.card.order.prospectBoost': {
    kind: 'number',
    default: 6,
    min: 0,
    max: 50,
    unit: 'points',
    category: RIVAL_BOOKING_CATEGORY,
    description: "Card score added to a segment with one of the promotion's prospects in it",
    docRef: CARD_SCORE_DOC_REF,
  },
  'aip.card.order.talkFactor': {
    kind: 'number',
    default: 0.8,
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'multiplier',
    category: RIVAL_BOOKING_CATEGORY,
    description: "How much of its speakers' card value a talking segment scores",
    docRef: CARD_SCORE_DOC_REF,
  },
  'aip.card.order.hotOpener': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: RIVAL_BOOKING_CATEGORY,
    description: 'Whether the second-best match opens the show',
    docRef: ORDERING_DOC_REF,
  },
});
