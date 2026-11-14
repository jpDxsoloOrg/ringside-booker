/**
 * Deal terms: what a network pays for a show and what it charges for airtime, from the projected
 * audience against what the network expects (ECO8-03).
 *
 * ratio            = projected ÷ benchmark (0 when the network expects nobody)
 * valued viewers   = min(projected, benchmark × valuedViewersCap)
 * shortfall factor = min(ratio, 1)
 *
 * - **TV:** rate = tvPerThousand × liveFeeBonus (live only);
 *   fee per show = valued viewers ÷ 1,000 × rate × (1 − tvBonusShare) × shortfall factor;
 *   per thousand viewers = rate × tvBonusShare.
 * - **Streaming:** the same with streamingPerThousand, all of it as the fee: no per-thousand part.
 * - **Pay-per-view:** no fee; per thousand buys = ppvPerThousandBuys × shortfall factor.
 * - **Airtime** = covered people ÷ 1,000,000 × airtimePerMillion (ppvAirtimePerMillion on
 *   pay-per-view) × (reach tier + 1), × the streaming factor for streaming, rounded down to a whole
 *   amount (no odd cents).
 *
 * Every amount is rounded down to whole cents. There is no randomness: the same inputs always give
 * the same terms, so the preview the player sees is what a proposal signs.
 *
 * Design: docs/design/broadcast.md#valuation.
 */

import { CENTS_PER_UNIT } from '../../../core/money';
import { inputOf, startCalc, type Calc, type Traced } from '../../../core/trace';
import type { NetworkKind } from '../../../model/entities/network';
import type { EngineTunables } from '../../tunables';

export const VALUATION_DOC_REF = 'broadcast.md#valuation';

export const NO_BENCHMARK_NOTE =
  'The network expects nobody in this slot, so there is nothing to measure against';
export const PPV_NO_FEE_NOTE = 'Pay-per-view pays per buy, not a flat fee';
export const STREAMING_NO_PER_THOUSAND_NOTE = 'A streaming service pays a flat fee only';

export interface DealTermsInputs {
  readonly kind: NetworkKind;
  readonly live: boolean;
  /** The promotion's projected audience (buys on pay-per-view). */
  readonly projected: Traced<number>;
  /** What the network expects in the same slot. */
  readonly benchmark: Traced<number>;
  /** People living in the regions the network covers. */
  readonly coveredPopulation: number;
  /** The network's reach tier, 0 (local) to 4 (global). */
  readonly reachTier: number;
  /** For the Why? labels; "the network" when left out. */
  readonly networkName?: string;
}

/** The terms a network offers, all money in whole cents, each with its Why?. */
export interface DealTermsResult {
  readonly feePerShow: Traced<number>;
  readonly perThousandViewers: Traced<number>;
  readonly costPerShow: Traced<number>;
  /** Projected audience ÷ what the network expects. */
  readonly ratio: Traced<number>;
}

const PER_THOUSAND = 1_000;
const PER_MILLION = 1_000_000;

/** Projected ÷ benchmark, or 0 with a note when the network expects nobody. */
export function audienceRatio(
  projected: Traced<number>,
  benchmark: Traced<number>,
  networkName: string,
): Traced<number> {
  const label = `Your audience against what ${networkName} expects`;
  if (benchmark.value === 0) {
    return startCalc(label, 0, {
      unit: 'ratio',
      docRef: VALUATION_DOC_REF,
      startLabel: NO_BENCHMARK_NOTE,
    }).done();
  }
  return startCalc(label, projected, { unit: 'ratio', docRef: VALUATION_DOC_REF })
    .divide(`What ${networkName} expects`, benchmark)
    .done();
}

/** min(ratio, 1): a network pays less when a promotion draws less than it expects. */
function shortfallFactor(ratio: Traced<number>): Traced<number> {
  return startCalc('Shortfall: what you draw against what it expects', ratio, {
    unit: 'ratio',
    docRef: VALUATION_DOC_REF,
  })
    .min('Never more than the full rate', 1)
    .done();
}

/** min(projected, benchmark × cap): the network pays the flat fee for no more than this. */
function valuedViewers(
  projected: Traced<number>,
  benchmark: Traced<number>,
  tunables: EngineTunables,
): Traced<number> {
  const capCalc = startCalc('Most viewers the network pays for', benchmark, {
    unit: 'count',
    docRef: VALUATION_DOC_REF,
  });
  const cap = capCalc
    .multiply(
      'Share of what it expects it will pay for',
      capCalc.tunable(tunables, 'broadcast.value.valuedViewersCap'),
    )
    .done();
  return startCalc('Viewers the network pays for', projected, {
    unit: 'count',
    docRef: VALUATION_DOC_REF,
  })
    .min('No more than the most it pays for', cap)
    .done();
}

/** Multiplies by the live fee bonus, or notes that a taped show gets none. */
function applyLiveBonus(calc: Calc, live: boolean, tunables: EngineTunables): void {
  if (live) {
    calc.multiply('Live show', calc.tunable(tunables, 'broadcast.value.liveFeeBonus'));
  } else {
    calc.note('Taped: no live bonus');
  }
}

function feePerShow(
  inputs: DealTermsInputs,
  shortfall: Traced<number>,
  tunables: EngineTunables,
): Traced<number> {
  if (inputs.kind === 'ppv') {
    return startCalc('Fee per show', 0, {
      unit: 'money',
      docRef: VALUATION_DOC_REF,
      startLabel: PPV_NO_FEE_NOTE,
    }).done();
  }
  const calc = startCalc(
    'Fee per show',
    valuedViewers(inputs.projected, inputs.benchmark, tunables),
    { unit: 'money', docRef: VALUATION_DOC_REF },
  );
  calc.divide('Counted in thousands', PER_THOUSAND);
  if (inputs.kind === 'tv') {
    calc.multiply(
      'TV rate per thousand viewers',
      calc.tunable(tunables, 'broadcast.value.tvPerThousand'),
    );
    applyLiveBonus(calc, inputs.live, tunables);
    const bonusShare = calc.tunable(tunables, 'broadcast.value.tvBonusShare');
    calc.multiply('Part paid as the flat fee (the rest is paid per viewer)', 1 - bonusShare);
  } else {
    calc.multiply(
      'Streaming rate per thousand viewers',
      calc.tunable(tunables, 'broadcast.value.streamingPerThousand'),
    );
    applyLiveBonus(calc, inputs.live, tunables);
  }
  return calc.multiply('Shortfall', shortfall).round('floor', 'Rounded down to the cent').done();
}

function perThousandViewers(
  inputs: DealTermsInputs,
  shortfall: Traced<number>,
  tunables: EngineTunables,
): Traced<number> {
  const options = { unit: 'money', docRef: VALUATION_DOC_REF } as const;
  switch (inputs.kind) {
    case 'streaming':
      return startCalc('Paid per thousand viewers', 0, {
        ...options,
        startLabel: STREAMING_NO_PER_THOUSAND_NOTE,
      }).done();
    case 'ppv': {
      const calc = startCalc('Paid per thousand buys', 0, { ...options, startLabel: 'Starting' });
      return calc
        .add(
          'Pay-per-view rate per thousand buys',
          calc.tunable(tunables, 'broadcast.value.ppvPerThousandBuys'),
        )
        .multiply('Shortfall', shortfall)
        .round('floor', 'Rounded down to the cent')
        .done();
    }
    case 'tv': {
      const calc = startCalc('Paid per thousand viewers', 0, {
        ...options,
        startLabel: 'Starting',
      });
      calc.add(
        'TV rate per thousand viewers',
        calc.tunable(tunables, 'broadcast.value.tvPerThousand'),
      );
      applyLiveBonus(calc, inputs.live, tunables);
      return calc
        .multiply(
          'Part paid per thousand viewers',
          calc.tunable(tunables, 'broadcast.value.tvBonusShare'),
        )
        .round('floor', 'Rounded down to the cent')
        .done();
    }
  }
}

function costPerShow(inputs: DealTermsInputs, tunables: EngineTunables): Traced<number> {
  const covered = inputOf(
    'People the network covers',
    inputs.coveredPopulation,
    undefined,
    'count',
  );
  const calc = startCalc('Airtime per show', covered, { unit: 'money', docRef: VALUATION_DOC_REF });
  calc.divide('Counted in millions', PER_MILLION);
  if (inputs.kind === 'ppv') {
    calc.multiply(
      'Pay-per-view airtime per million people, per reach tier step',
      calc.tunable(tunables, 'broadcast.value.ppvAirtimePerMillion'),
    );
  } else {
    calc.multiply(
      'Airtime per million people, per reach tier step',
      calc.tunable(tunables, 'broadcast.value.airtimePerMillion'),
    );
  }
  calc.multiply(`Reach tier ${String(inputs.reachTier)}: tier + 1 steps`, inputs.reachTier + 1);
  if (inputs.kind === 'streaming') {
    calc.multiply(
      'Streaming services charge less airtime',
      calc.tunable(tunables, 'broadcast.value.streamingAirtimeFactor'),
    );
  }
  calc.round('floor', 'Rounded down to the cent');
  const oddCents = calc.current % CENTS_PER_UNIT;
  return calc.subtract('Odd cents dropped: a whole amount', oddCents).done();
}

/** The terms a network offers for a show, from its projected audience and its benchmark. */
export function dealTerms(
  inputs: DealTermsInputs,
  deps: { readonly tunables: EngineTunables },
): DealTermsResult {
  const { tunables } = deps;
  const ratio = audienceRatio(
    inputs.projected,
    inputs.benchmark,
    inputs.networkName ?? 'the network',
  );
  const shortfall = shortfallFactor(ratio);
  return {
    feePerShow: feePerShow(inputs, shortfall, tunables),
    perThousandViewers: perThousandViewers(inputs, shortfall, tunables),
    costPerShow: costPerShow(inputs, tunables),
    ratio,
  };
}
