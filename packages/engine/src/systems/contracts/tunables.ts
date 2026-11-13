/**
 * The contracts system's balance numbers: the simple rival renewal rule that keeps rival rosters
 * stocked until the rival labour market (ECO6) exists (ECO4-01); severance, the "expiring soon"
 * notices and the player's temporary automatic renewal (ECO4-02). All in the `Contracts` category,
 * documented in docs/design/contracts.md.
 */

import { defineTunables } from '../../core/tunables/define';
import { PUSH_LEVELS } from '../../model/entities/employment';

export const CONTRACTS_TUNABLE_CATEGORY = 'Contracts';

const RENEWALS_DOC = 'contracts.md#simple-renewals';
const SEVERANCE_DOC = 'contracts.md#severance';
const EXPIRING_DOC = 'contracts.md#expiring-soon';
const PLAYER_RENEWAL_DOC = 'contracts.md#player-renewals';

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
  'contracts.severance.fullMonths': {
    kind: 'integer',
    default: 3,
    min: 0,
    max: 60,
    unit: 'months',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Months still owed that are paid in full',
    docRef: SEVERANCE_DOC,
  },
  'contracts.severance.tailRate': {
    kind: 'number',
    default: 0.35,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Share paid for each owed month beyond the full months',
    docRef: SEVERANCE_DOC,
  },
  'contracts.severance.capMonths': {
    kind: 'integer',
    default: 18,
    min: 0,
    max: 120,
    unit: 'months',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Owed months beyond this are not paid at all',
    docRef: SEVERANCE_DOC,
  },
  'contracts.severance.openEndedMonths': {
    kind: 'integer',
    default: 6,
    min: 0,
    max: 60,
    unit: 'months',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Months treated as owed on an open-ended deal',
    docRef: SEVERANCE_DOC,
  },
  'contracts.severance.appearancesPerMonth': {
    kind: 'integer',
    default: 4,
    min: 0,
    max: 31,
    unit: 'count',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Monthly value of a per-appearance deal, in appearances',
    docRef: SEVERANCE_DOC,
  },
  'contracts.severance.ironCladMultiplier': {
    kind: 'number',
    default: 2,
    min: 0,
    max: 10,
    step: 0.25,
    unit: 'multiplier',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Severance on an iron-clad contract is multiplied by this',
    docRef: SEVERANCE_DOC,
  },
  'contracts.severance.mutualMorale': {
    kind: 'integer',
    default: -50,
    min: -100,
    max: 100,
    unit: 'points',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'At or below this morale the worker is glad to go',
    docRef: SEVERANCE_DOC,
  },
  'contracts.severance.mutualDiscount': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Share of the severance a worker who is glad to go gives up',
    docRef: SEVERANCE_DOC,
  },
  'contracts.severance.unstartedFactor': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: "Share due when calling off a deal that hasn't started",
    docRef: SEVERANCE_DOC,
  },
  'contracts.expiring.windowDays': {
    kind: 'integer',
    default: 60,
    min: 1,
    max: 365,
    unit: 'days',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Contracts ending within this many days are listed as expiring',
    docRef: EXPIRING_DOC,
  },
  'contracts.expiringSoon.days': {
    kind: 'integer',
    default: 30,
    min: 0,
    max: 365,
    unit: 'days',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description:
      'Raise a notice when one of your contracts ends within this many days (0 = no notices)',
    docRef: EXPIRING_DOC,
  },
  'contracts.expiringSoon.minPush': {
    kind: 'enum',
    default: 'midCard',
    options: PUSH_LEVELS,
    unit: 'choice',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'Notices only for workers at or above this push',
    docRef: EXPIRING_DOC,
  },
  'contracts.expiringSoon.stopSkip': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description: 'A new expiry notice stops a skip until you mark it as seen',
    docRef: EXPIRING_DOC,
  },
  'contracts.autoRenewPlayer': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: CONTRACTS_TUNABLE_CATEGORY,
    description:
      'Temporary: your contracts renew on the same terms for the same length when they run out, until you can renew them yourself',
    docRef: PLAYER_RENEWAL_DOC,
  },
});
