/**
 * The contracts system's balance numbers (ECO4-01): the simple rival renewal rule that keeps rival
 * rosters stocked until the rival labour market (ECO6) exists. All in the `Contracts` category,
 * documented in docs/design/contracts.md.
 */

import { defineTunables } from '../../core/tunables/define';
import { PUSH_LEVELS } from '../../model/entities/employment';

export const CONTRACTS_TUNABLE_CATEGORY = 'Contracts';

const RENEWALS_DOC = 'contracts.md#simple-renewals';

function contractDays(defaultValue: number, description: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: 1,
    max: 3650,
    unit: 'days',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description,
    docRef: RENEWALS_DOC,
  } as const;
}

export const contractsTunables = defineTunables({
  'ai.contracts.simpleRenewals': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description:
      'Rival promotions renew contracts by a simple rule until the rival labour market exists; off under a level playing field',
    docRef: RENEWALS_DOC,
  },
  'contracts.ai.keepPushAtOrAbove': {
    kind: 'enum',
    default: 'upperCard',
    options: PUSH_LEVELS,
    unit: 'choice',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'A rival always renews workers pushed at this card position or higher',
    docRef: RENEWALS_DOC,
  },
  'contracts.ai.keepChampions': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'A rival always renews a worker who holds one of its titles',
    docRef: RENEWALS_DOC,
  },
  'contracts.ai.renewChance': {
    kind: 'number',
    default: 0.6,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'probability',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Chance a rival renews any other worker whose contract runs out',
    docRef: RENEWALS_DOC,
  },
  'contracts.ai.renewMinDays': contractDays(365, 'Shortest new contract a rival renewal gives'),
  'contracts.ai.renewMaxDays': contractDays(
    1095,
    'Longest new contract a rival renewal gives (if below the shortest, the two swap)',
  ),
});
