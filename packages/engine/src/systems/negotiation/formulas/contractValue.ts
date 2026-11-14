/**
 * Contract value (ECO5-03): one monthly figure for everything an offer holds, so a worker can
 * weigh it against their own ask and against other promotions' offers.
 *
 * 1. the monthly wage, + the fee per appearance × `contracts.value.appearancesPerMonth` (at most
 *    the appearance cap ÷ 12 when the offer caps appearances);
 * 2. + the signing bonus spread over the contract's months;
 * 3. × (1 + the premium of each perk the game honours: `contracts.value.perk.<perk>`). A perk the
 *    game does not honour yet adds nothing, and the Why? says so;
 * 4. × (1 + each revenue share the game pays, in percent, × `contracts.value.sharePerPercent`);
 *    an unpaid share adds nothing, with the same line;
 * 5. card position: × (1 − `contracts.value.pushBelowPerStep`) for each step below the push they
 *    expect, × (1 + `contracts.value.pushAbovePerStep`) for each step above (crew are not pushed);
 * 6. length: × (1 − `contracts.value.lengthMismatchPerMonth` × months away from the length they
 *    prefer), at least `contracts.value.lengthFitMin`;
 * 7. rounded to whole cents.
 *
 * Design: docs/design/negotiation.md#contract-value.
 */

import { constantOf, inputOf } from '../../../core/trace/helpers';
import { startCalc, type Calc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import {
  PUSH_LEVELS,
  type ContractPerks,
  type ContractTerms,
  type Push,
  type RevenueShares,
} from '../../../model/entities/employment';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { PUSH_LABELS } from '../../workers/formulas/expectedPush';
import type { EnforceableTerm } from '../registries';
import { CONTRACT_VALUE_DOC_REF, moneyText } from './shared';

export interface ContractValueInputs {
  readonly terms: ContractTerms;
  readonly lengthMonths: number;
  readonly push: Push;
  readonly expectedPush: Push;
  readonly preferredLengthMonths: number;
  /** The terms the game honours today (`listEnforcedTerms`). */
  readonly enforced: ReadonlySet<EnforceableTerm>;
}

/** The perks in the order the Why? lists them, with their premium. */
const PERKS: readonly {
  readonly perk: keyof ContractPerks;
  readonly term: EnforceableTerm;
  readonly label: string;
  readonly key: NumberTunableKey;
}[] = [
  {
    perk: 'ironClad',
    term: 'perk.ironClad',
    label: 'Iron-clad',
    key: 'contracts.value.perk.ironClad',
  },
  {
    perk: 'travelCovered',
    term: 'perk.travelCovered',
    label: 'Travel covered',
    key: 'contracts.value.perk.travelCovered',
  },
  {
    perk: 'noHouseShows',
    term: 'perk.noHouseShows',
    label: 'No house shows',
    key: 'contracts.value.perk.noHouseShows',
  },
  {
    perk: 'creativeControl',
    term: 'perk.creativeControl',
    label: 'Creative control',
    key: 'contracts.value.perk.creativeControl',
  },
];

/** The revenue shares in the order the Why? lists them. */
const SHARES: readonly {
  readonly share: keyof RevenueShares;
  readonly term: EnforceableTerm;
  readonly label: string;
}[] = [
  { share: 'gateBp', term: 'share.gateBp', label: 'Share of the gate' },
  { share: 'merchBp', term: 'share.merchBp', label: 'Share of merch' },
  { share: 'broadcastBp', term: 'share.broadcastBp', label: 'Share of TV money' },
];

/** The Why? line of a term the game does not honour yet. */
export function notEnforcedLine(label: string): string {
  return `${label}: not enforced by the game yet, adds nothing`;
}

const MONTHS_A_YEAR = constantOf('Months in a year', 12, 'A cap is set per year');
const BASIS_POINTS_A_PERCENT = constantOf(
  'Basis points in a percent',
  100,
  'Shares are kept in hundredths of a percent',
);

function months(count: number): string {
  return count === 1 ? '1 month' : `${String(count)} months`;
}

function steps(count: number): string {
  return count === 1 ? '1 step' : `${String(count)} steps`;
}

function appearanceFees(terms: ContractTerms, tunables: EngineTunables): Traced<number> {
  const appearances = startCalc('Appearances a month', 0, {
    unit: 'count',
    docRef: CONTRACT_VALUE_DOC_REF,
    startLabel: 'None yet',
  });
  appearances.add(
    'Usual appearances a month',
    appearances.tunable(tunables, 'contracts.value.appearancesPerMonth'),
  );
  if (terms.appearanceCap !== null) {
    const perMonth = startCalc(
      'Appearance cap a month',
      inputOf('Appearance cap a year', terms.appearanceCap, undefined, 'count'),
      { unit: 'count' },
    )
      .divide('Months in a year', MONTHS_A_YEAR)
      .done();
    appearances.min('Appearance cap', perMonth);
  }
  return startCalc(
    'Appearance fees',
    inputOf(`Fee per appearance: ${moneyText(terms.perAppearanceFee)}`, terms.perAppearanceFee),
    { unit: 'money' },
  )
    .multiply('Appearances a month', appearances.done())
    .done();
}

function perkPremiums(
  perks: ContractPerks,
  enforced: ReadonlySet<EnforceableTerm>,
  tunables: EngineTunables,
): Traced<number> | null {
  const set = PERKS.filter((entry) => perks[entry.perk]);
  if (set.length === 0) {
    return null;
  }
  const calc = startCalc('Perks', 1, {
    unit: 'multiplier',
    docRef: CONTRACT_VALUE_DOC_REF,
    startLabel: 'No perks',
  });
  for (const entry of set) {
    if (enforced.has(entry.term)) {
      calc.add(entry.label, calc.tunable(tunables, entry.key));
    } else {
      calc.branch(notEnforcedLine(entry.label), false);
    }
  }
  return calc.done();
}

function sharePremiums(
  shares: RevenueShares,
  enforced: ReadonlySet<EnforceableTerm>,
  tunables: EngineTunables,
): Traced<number> | null {
  const set = SHARES.filter((entry) => shares[entry.share] > 0);
  if (set.length === 0) {
    return null;
  }
  const calc = startCalc('Revenue shares', 1, {
    unit: 'multiplier',
    docRef: CONTRACT_VALUE_DOC_REF,
    startLabel: 'No shares',
  });
  for (const entry of set) {
    if (!enforced.has(entry.term)) {
      calc.branch(notEnforcedLine(entry.label), false);
      continue;
    }
    const share = startCalc(
      entry.label,
      inputOf(`${entry.label} in basis points`, shares[entry.share], undefined, 'count'),
      { unit: 'ratio' },
    );
    share.divide('In percent', BASIS_POINTS_A_PERCENT);
    share.multiply('Worth per percent', share.tunable(tunables, 'contracts.value.sharePerPercent'));
    calc.add(entry.label, share.done());
  }
  return calc.done();
}

function pushFit(calc: Calc, push: Push, expected: Push, tunables: EngineTunables): void {
  if (expected === 'none') {
    calc.branch('Crew are not pushed: card position does not count', true);
    return;
  }
  const gap = PUSH_LEVELS.indexOf(push) - PUSH_LEVELS.indexOf(expected);
  if (gap === 0) {
    calc.branch(`${PUSH_LABELS[push]}, the card position they expect`, true);
    return;
  }
  const below = gap > 0;
  const label = below
    ? `${PUSH_LABELS[push]}: ${steps(gap)} below the ${PUSH_LABELS[expected]} they expect`
    : `${PUSH_LABELS[push]}: ${steps(-gap)} above the ${PUSH_LABELS[expected]} they expect`;
  const perStep = startCalc('Each step', 1, {
    unit: 'multiplier',
    docRef: CONTRACT_VALUE_DOC_REF,
    startLabel: 'Unchanged',
  });
  if (below) {
    perStep.subtract(
      'Lost for each step below',
      perStep.tunable(tunables, 'contracts.value.pushBelowPerStep'),
    );
  } else {
    perStep.add(
      'Gained for each step above',
      perStep.tunable(tunables, 'contracts.value.pushAbovePerStep'),
    );
  }
  const factor = startCalc('Card position', perStep.done(), { unit: 'multiplier' })
    .power(steps(Math.abs(gap)), Math.abs(gap))
    .done();
  calc.multiply(label, factor);
}

function lengthFit(
  calc: Calc,
  lengthMonths: number,
  preferred: number,
  tunables: EngineTunables,
): void {
  const away = Math.abs(lengthMonths - preferred);
  if (away === 0) {
    calc.branch(`${months(lengthMonths)}, the length they prefer`, true);
    return;
  }
  const fit = startCalc('Contract length', 1, {
    unit: 'multiplier',
    docRef: CONTRACT_VALUE_DOC_REF,
    startLabel: 'Unchanged',
  });
  const lost = startCalc(
    'Lost for the length',
    inputOf('Months away from the length they prefer', away, undefined, 'months'),
    { unit: 'ratio' },
  );
  lost.multiply(
    'Lost for each month',
    lost.tunable(tunables, 'contracts.value.lengthMismatchPerMonth'),
  );
  fit.subtract(`${months(away)} away from the length they prefer`, lost.done());
  fit.max('Least a length counts for', fit.tunable(tunables, 'contracts.value.lengthFitMin'));
  calc.multiply(`${months(lengthMonths)}; they prefer ${months(preferred)}`, fit.done());
}

/** What an offer is worth to the worker each month, in whole cents, every step traced. */
export function contractValue(
  inputs: ContractValueInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const { terms } = inputs;
  const calc = startCalc(
    'Contract value',
    inputOf(`Monthly wage: ${moneyText(terms.monthlyWage)}`, terms.monthlyWage, undefined, 'money'),
    { unit: 'money/month', docRef: CONTRACT_VALUE_DOC_REF },
  );
  if (terms.perAppearanceFee > 0) {
    calc.add('Appearance fees', appearanceFees(terms, tunables));
  }
  if (terms.signingBonus > 0) {
    const spread = startCalc(
      'Signing bonus a month',
      inputOf(`Signing bonus: ${moneyText(terms.signingBonus)}`, terms.signingBonus),
      { unit: 'money' },
    )
      .divide(
        'Contract length',
        inputOf('Contract length', inputs.lengthMonths, undefined, 'months'),
      )
      .done();
    calc.add(`Signing bonus spread over ${months(inputs.lengthMonths)}`, spread);
  }
  const perks = perkPremiums(terms.perks, inputs.enforced, tunables);
  if (perks !== null) {
    calc.multiply('Perks', perks);
  }
  const shares = sharePremiums(terms.shares, inputs.enforced, tunables);
  if (shares !== null) {
    calc.multiply('Revenue shares', shares);
  }
  pushFit(calc, inputs.push, inputs.expectedPush, tunables);
  lengthFit(calc, inputs.lengthMonths, inputs.preferredLengthMonths, tunables);
  return calc.round('round', 'To whole cents').done();
}
