/**
 * Asking wage: the monthly wage a worker asks one promotion for, built from their market value.
 * Every step is a factor or a limit, so the ask moves smoothly with reach and public image. In
 * order:
 *
 * 1. × reach factor `contracts.ask.reachFloor + (1 − reachFloor) × reach ÷ 100`: a promotion
 *    nobody has heard of gets a smaller ask (smaller stage, smaller pay day);
 * 2. × public image `1 − contracts.ask.prestigeDiscount × prestige ÷ 100` (the discount ×
 *    `contracts.ask.legacyPrestigeMultiplier` for a worker who cares about their legacy), never
 *    below 0;
 * 3. × (1 + ego premium): egotist, in it for the money and star presence (charisma or presence of
 *    `contracts.ask.starPresence` or more) add their premiums, selfless takes a discount off, and
 *    the total is limited to `contracts.ask.premiumCap`;
 * 4. × (1 + `contracts.ask.exclusivePremium`) for an exclusive contract;
 * 5. × (1 + `contracts.ask.underContractPremium`) while under contract elsewhere (a rival's wage
 *    is private, so this stands in for it);
 * 6. renewals: × (1 + `contracts.renewal.unhappyPremiumPerPoint` × points below
 *    `contracts.renewal.unhappyMorale`) when morale is below that line, and × (1 −
 *    `contracts.ask.loyalRenewalDiscount`) for a loyal worker;
 * 7. × each registered ask modifier (and the offer kind's own multiplier);
 * 8. at most `contracts.ask.cap.<role>`;
 * 9. rounded to the nearest $100;
 * 10. at least the worker's current wage with this promotion (never a rival's).
 *
 * The current-deal floor comes after the rounding so it holds to the cent.
 *
 * Design: docs/design/negotiation.md#asking-terms and #renewals.
 */

import { startCalc } from '../../../core/trace/calc';
import { constantOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { EmploymentRole } from '../../../model/entities/employment';
import type { Motivation, TraitKey } from '../../../model/entities/person';
import type { EngineTunables } from '../../tunables';
import {
  ASKING_TERMS_DOC_REF,
  oneMinus,
  onePlus,
  OUT_OF_100,
  RENEWALS_DOC_REF,
  signedText,
  wholeText,
} from './shared';

export interface AskingWageRenewal {
  /** The worker's morale under the contract being renewed, −100 to 100. */
  readonly morale: number;
  /** True for a loyal worker renewing with you. */
  readonly loyalToYou: boolean;
}

export interface AskingWageInputs {
  readonly marketValue: Traced<number>;
  /** The promotion's reach, 0-100. */
  readonly reach: number;
  /** The promotion's public image, 0-100. */
  readonly prestige: number;
  readonly motivation: Motivation;
  readonly traits: readonly TraitKey[];
  readonly charisma: number;
  readonly presence: number;
  readonly role: EmploymentRole;
  readonly exclusive: boolean;
  readonly underContractElsewhere: boolean;
  /** The contract being renewed, or null for a signing. */
  readonly renewal: AskingWageRenewal | null;
  /** Registered ask modifiers (and the offer kind's multiplier), applied as factors in order. */
  readonly modifiers: readonly Traced<number>[];
  /** The worker's current monthly wage with this promotion, or null. Never a rival's. */
  readonly currentDealFloor: number | null;
}

export const ROLE_CAP_KEYS = {
  wrestler: 'contracts.ask.cap.wrestler',
  manager: 'contracts.ask.cap.manager',
  presenter: 'contracts.ask.cap.presenter',
  announcer: 'contracts.ask.cap.announcer',
  referee: 'contracts.ask.cap.referee',
  producer: 'contracts.ask.cap.producer',
  booker: 'contracts.ask.cap.booker',
} as const;

export const CURRENT_DEAL_FLOOR_LABEL = "Won't take less than their current deal with you";
export const HUNDREDS_REASON = 'Asks are quoted in hundreds';

/** $100 in cents: the step asks are quoted in. */
const HUNDRED_DOLLARS = 10_000;

function reachFactor(reach: number, tunables: EngineTunables): Traced<number> {
  const aboveFloor = oneMinus(
    'Share that grows with reach',
    'Reach floor',
    tunables,
    'contracts.ask.reachFloor',
    ASKING_TERMS_DOC_REF,
  );
  const grown = startCalc('Grown with reach', reach, {
    unit: 'ratio',
    docRef: ASKING_TERMS_DOC_REF,
    startLabel: `Reach ${wholeText(reach)}`,
  })
    .divide('Out of 100', OUT_OF_100)
    .multiply('Share that grows with reach', aboveFloor)
    .done();
  const calc = startCalc(`Your reach ${wholeText(reach)}`, 0, {
    unit: 'multiplier',
    docRef: ASKING_TERMS_DOC_REF,
    startLabel: 'Nothing yet',
  });
  calc.add('Asked even at reach 0', calc.tunable(tunables, 'contracts.ask.reachFloor'));
  return calc.add('Grown with reach', grown).done();
}

function prestigeFactor(
  prestige: number,
  motivation: Motivation,
  tunables: EngineTunables,
): Traced<number> {
  const discount = startCalc('Public image discount', prestige, {
    unit: 'ratio',
    docRef: ASKING_TERMS_DOC_REF,
    startLabel: `Public image ${wholeText(prestige)}`,
  });
  discount.divide('Out of 100', OUT_OF_100);
  discount.multiply(
    'Discount at a public image of 100',
    discount.tunable(tunables, 'contracts.ask.prestigeDiscount'),
  );
  const legacy = motivation === 'legacy';
  discount.branch('Cares about their legacy', legacy);
  if (legacy) {
    discount.multiply(
      'Cares about their legacy',
      discount.tunable(tunables, 'contracts.ask.legacyPrestigeMultiplier'),
    );
  }
  return startCalc('Your public image', 1, {
    unit: 'multiplier',
    docRef: ASKING_TERMS_DOC_REF,
    startLabel: 'Unchanged',
  })
    .subtract('Public image discount', discount.done())
    .max('Never below zero', 0)
    .done();
}

function egoPremium(inputs: AskingWageInputs, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Ego premium', 0, {
    unit: 'ratio',
    docRef: ASKING_TERMS_DOC_REF,
    startLabel: 'No premium',
  });
  const egotist = inputs.traits.includes('egotist');
  calc.branch('Egotist', egotist);
  if (egotist) {
    calc.add('Egotist', calc.tunable(tunables, 'contracts.ask.egotistPremium'));
  }
  const money = inputs.motivation === 'money';
  calc.branch('In it for the money', money);
  if (money) {
    calc.add('In it for the money', calc.tunable(tunables, 'contracts.ask.moneyPremium'));
  }
  const presence = Math.max(inputs.charisma, inputs.presence);
  const star = presence >= tunables.get('contracts.ask.starPresence');
  calc.branch(`Star presence (${wholeText(presence)})`, star);
  if (star) {
    calc.add(
      `Star presence (${wholeText(presence)})`,
      calc.tunable(tunables, 'contracts.ask.starPremium'),
    );
  }
  const selfless = inputs.traits.includes('selfless');
  calc.branch('Selfless', selfless);
  if (selfless) {
    calc.subtract('Selfless', calc.tunable(tunables, 'contracts.ask.selflessDiscount'));
  }
  return calc.min('Limited to', calc.tunable(tunables, 'contracts.ask.premiumCap')).done();
}

function unhappyFactor(morale: number, tunables: EngineTunables): Traced<number> {
  const points = startCalc('Points below the unhappy line', 0, {
    unit: 'points',
    docRef: RENEWALS_DOC_REF,
    startLabel: 'Nothing yet',
  });
  points.add('Unhappy line', points.tunable(tunables, 'contracts.renewal.unhappyMorale'));
  points.subtract(`Morale ${signedText(morale)}`, morale);
  const premium = startCalc('Unhappy premium', points.done(), {
    unit: 'ratio',
    docRef: RENEWALS_DOC_REF,
  });
  premium.multiply(
    'Extra for each point',
    premium.tunable(tunables, 'contracts.renewal.unhappyPremiumPerPoint'),
  );
  return startCalc(`Morale ${signedText(morale)}: unhappy here`, 1, {
    unit: 'multiplier',
    docRef: RENEWALS_DOC_REF,
    startLabel: 'Unchanged',
  })
    .add('Unhappy premium', premium.done())
    .done();
}

/** The monthly wage a worker asks this promotion for, in whole cents, every step traced. */
export function askingWage(
  inputs: AskingWageInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc('Asking wage', inputs.marketValue, {
    unit: 'money',
    docRef: ASKING_TERMS_DOC_REF,
  });
  calc.multiply(`Your reach ${wholeText(inputs.reach)}`, reachFactor(inputs.reach, tunables));
  calc.multiply('Your public image', prestigeFactor(inputs.prestige, inputs.motivation, tunables));
  const premium = egoPremium(inputs, tunables);
  calc.multiply(
    'Ego premium',
    startCalc('Ego factor', 1, {
      unit: 'multiplier',
      docRef: ASKING_TERMS_DOC_REF,
      startLabel: 'Unchanged',
    })
      .add('Ego premium', premium)
      .done(),
  );

  calc.branch('Exclusive contract', inputs.exclusive);
  if (inputs.exclusive) {
    calc.multiply(
      'Exclusive contract',
      onePlus(
        'Exclusive contract',
        'Exclusive premium',
        tunables,
        'contracts.ask.exclusivePremium',
        ASKING_TERMS_DOC_REF,
      ),
    );
  }
  calc.branch('Under contract elsewhere', inputs.underContractElsewhere);
  if (inputs.underContractElsewhere) {
    calc.multiply(
      'Under contract elsewhere',
      onePlus(
        'Under contract elsewhere',
        'Premium to leave',
        tunables,
        'contracts.ask.underContractPremium',
        ASKING_TERMS_DOC_REF,
      ),
    );
  }

  if (inputs.renewal !== null) {
    const { morale, loyalToYou } = inputs.renewal;
    const unhappy = morale < tunables.get('contracts.renewal.unhappyMorale');
    calc.branch(`Morale ${signedText(morale)}: unhappy here`, unhappy);
    if (unhappy) {
      calc.multiply(`Morale ${signedText(morale)}: unhappy here`, unhappyFactor(morale, tunables));
    }
    calc.branch('Loyal to you', loyalToYou);
    if (loyalToYou) {
      calc.multiply(
        'Loyal to you',
        oneMinus(
          'Loyal to you',
          'Loyalty discount',
          tunables,
          'contracts.ask.loyalRenewalDiscount',
          RENEWALS_DOC_REF,
        ),
      );
    }
  }

  for (const modifier of inputs.modifiers) {
    calc.multiply(modifier.trace.label, modifier);
  }

  calc.min(`Most a ${inputs.role} asks for`, calc.tunable(tunables, ROLE_CAP_KEYS[inputs.role]));
  const hundred = constantOf('$100', HUNDRED_DOLLARS, HUNDREDS_REASON);
  calc
    .divide('In hundreds', hundred)
    .round('round', HUNDREDS_REASON)
    .multiply('Back to cents', hundred);
  if (inputs.currentDealFloor !== null) {
    calc.max(CURRENT_DEAL_FLOOR_LABEL, inputs.currentDealFloor);
  }
  return calc.done();
}
