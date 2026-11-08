/**
 * World generation tunables (the WLD epic): the balance numbers the generators read when they
 * build people, names and places. Merged into `ALL_TUNABLES` in `systems/tunables.ts`.
 */

import { defineTunables } from '../../core/tunables/define';

const NAMES_CATEGORY = 'World generation';
const NAMES_DOC = 'names.md#tunables';

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
});
