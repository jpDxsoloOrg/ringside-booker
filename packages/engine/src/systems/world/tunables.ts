/**
 * World generation tunables (the WLD epic): the balance numbers the generators read when they
 * build people, names and places. The distributions themselves (roles, styles, bodies, attribute
 * profiles) are pack data in `content/base/generation/`; these are the global knobs on top.
 * Merged into `ALL_TUNABLES` in `systems/tunables.ts`.
 */

import { defineTunables } from '../../core/tunables/define';

const NAMES_CATEGORY = 'World generation';
const NAMES_DOC = 'names.md#tunables';
const PEOPLE_CATEGORY = NAMES_CATEGORY;
const PEOPLE_DOC = 'world-generation.md#tunables';

export const worldTunables = defineTunables({
  'worldgen.names.neutralGivenShare': {
    kind: 'number',
    default: 0.05,
    min: 0,
    max: 1,
    step: 0.01,
    unit: 'probability',
    category: NAMES_CATEGORY,
    description:
      'Chance that a man or woman gets a given name from the neutral list instead of the list for their gender.',
    docRef: NAMES_DOC,
  },
  'worldgen.names.nonbinaryNeutralShare': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    unit: 'probability',
    category: NAMES_CATEGORY,
    description:
      'Chance that a non-binary person gets a given name from the neutral list. Otherwise it comes from the male or female list, 50/50.',
    docRef: NAMES_DOC,
  },
  'worldgen.names.mixedHeritageChance': {
    kind: 'number',
    default: 0.08,
    min: 0,
    max: 1,
    step: 0.01,
    unit: 'probability',
    category: NAMES_CATEGORY,
    description:
      "Chance that a person's surname comes from a second pick of their country's name cultures instead of the culture their given name came from.",
    docRef: NAMES_DOC,
  },
  'worldgen.names.maxRetries': {
    kind: 'integer',
    default: 20,
    min: 0,
    max: 200,
    unit: 'count',
    category: NAMES_CATEGORY,
    description:
      'How many times the name generator rolls a fresh name when the one it rolled is already taken, before it starts adding middle initials.',
    docRef: NAMES_DOC,
  },
  'worldgen.people.homeStyleBoost': {
    kind: 'number',
    default: 3,
    min: 0,
    max: 20,
    step: 0.1,
    unit: 'multiplier',
    category: PEOPLE_CATEGORY,
    description:
      "Multiplies the weight of the ring styles that suit a new wrestler's home region (or country). 1 means home makes no difference.",
    docRef: PEOPLE_DOC,
  },
  'worldgen.people.standoutChance': {
    kind: 'number',
    default: 0.015,
    min: 0,
    max: 1,
    step: 0.005,
    unit: 'probability',
    category: PEOPLE_CATEGORY,
    description:
      'Chance that a new wrestler is a natural standout: one in-ring or character attribute gets a large bonus.',
    docRef: PEOPLE_DOC,
  },
  'worldgen.people.standoutBonusMean': {
    kind: 'number',
    default: 18,
    min: 0,
    max: 50,
    step: 1,
    unit: 'points',
    category: PEOPLE_CATEGORY,
    description: 'Average bonus a natural standout adds to their standout attribute.',
    docRef: PEOPLE_DOC,
  },
  'worldgen.people.standoutBonusSd': {
    kind: 'number',
    default: 6,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 'points',
    category: PEOPLE_CATEGORY,
    description: 'Spread (standard deviation) of the natural standout bonus.',
    docRef: PEOPLE_DOC,
  },
  'worldgen.people.standoutBonusMin': {
    kind: 'number',
    default: 8,
    min: 0,
    max: 50,
    step: 1,
    unit: 'points',
    category: PEOPLE_CATEGORY,
    description: 'Smallest natural standout bonus.',
    docRef: PEOPLE_DOC,
  },
  'worldgen.people.standoutBonusMax': {
    kind: 'number',
    default: 30,
    min: 0,
    max: 50,
    step: 1,
    unit: 'points',
    category: PEOPLE_CATEGORY,
    description: 'Largest natural standout bonus. If it is below the smallest, the smallest wins.',
    docRef: PEOPLE_DOC,
  },
  'worldgen.people.wearPerYear': {
    kind: 'number',
    default: 1.6,
    min: 0,
    max: 10,
    step: 0.1,
    unit: 'points',
    category: PEOPLE_CATEGORY,
    description:
      "Expected body wear per year since debut, per body part, before the ring style's wear multiplier.",
    docRef: PEOPLE_DOC,
  },
  'worldgen.people.wearSd': {
    kind: 'number',
    default: 5,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 'points',
    category: PEOPLE_CATEGORY,
    description: 'Spread (standard deviation) of the starting wear on each body part.',
    docRef: PEOPLE_DOC,
  },
  'worldgen.people.wearMax': {
    kind: 'number',
    default: 45,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: PEOPLE_CATEGORY,
    description:
      'Most wear a body part can start with, so a new person never starts below 100 minus this.',
    docRef: PEOPLE_DOC,
  },
  'worldgen.people.debutAgeMean': {
    kind: 'number',
    default: 21,
    min: 14,
    max: 30,
    step: 0.5,
    unit: 'years',
    category: PEOPLE_CATEGORY,
    description:
      "Average age at which a generated person debuted, for roles that debut. The role's spread and limits come from the base pack.",
    docRef: PEOPLE_DOC,
  },
  'worldgen.people.canBookFrom': {
    kind: 'integer',
    default: 60,
    min: 0,
    max: 100,
    unit: 'points',
    category: PEOPLE_CATEGORY,
    description: 'Booking attribute at which a generated person can work as a booker.',
    docRef: PEOPLE_DOC,
  },
});
