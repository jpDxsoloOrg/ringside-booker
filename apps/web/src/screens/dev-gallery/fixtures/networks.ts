import {
  airingTraceRef,
  cents,
  dealHealthTraceRef,
  inputOf,
  parseGameDate,
  parseId,
  startCalc,
} from '@ringside/engine';
import type {
  BroadcastIncomeSummary,
  DealRecentAiring,
  DealRow,
  DealTargets,
  DealValuation,
  GameDate,
  StoredTraceEntry,
  TraceNode,
  Traced,
} from '@ringside/engine';

/**
 * Hand-written Networks screen data for the gallery: deal rows as `broadcast.deals` returns them
 * (a TV deal, a pay-per-view deal and an ended one), two `broadcast.valuation` answers (one the
 * network accepts, one it refuses) and a `broadcast.incomeSummary`. Gallery data only, all
 * invented; no engine is asked except the stand-in trace lookups below.
 */

export const GALLERY_NETWORKS_TODAY: GameDate = parseGameDate('2027-01-08');

function counted(label: string, value: number, because: string): Traced<number> {
  const result = startCalc(label, inputOf(because, value), { unit: 'count' }).done();
  return { value: result.value, trace: result.trace };
}

function money(label: string, value: number, because: string): Traced<number> {
  const result = startCalc(label, inputOf(because, value, undefined, 'money'), {
    unit: 'money',
  }).done();
  return { value: result.value, trace: result.trace };
}

function note(label: string, lines: readonly string[]): TraceNode {
  const calc = startCalc(label, 0, { startLabel: 'Checks' });
  for (const line of lines) calc.note(line);
  return calc.done().trace;
}

/** A deal's three lines at the shipped shares (75%, 55%, 115%), as the engine words them. */
function targets(expected: number): DealTargets {
  const line = (label: string, share: number) => ({
    viewers: counted(
      label,
      Math.ceil((expected * Math.round(share * 100)) / 100),
      `${String(Math.round(share * 100))}% of what the network expects`,
    ),
    share,
  });
  return {
    expected,
    safe: line('Stay above this to stay safe', 0.75),
    cancel: line('Below this the network may cancel', 0.55),
    bonus: line('Beat this for a ratings bonus', 1.15),
  };
}

const TV_DEAL = parseId('deal', 'dea_0000000101');
const PPV_DEAL = parseId('deal', 'dea_0000000102');
const ENDED_DEAL = parseId('deal', 'dea_0000000103');
const TV_AIRING = parseId('airing', 'air_0000000101');

function recent(viewers: readonly number[], expected: number): DealRecentAiring[] {
  return viewers.map((count, index) => ({
    airDate: parseGameDate(`2026-12-${String(3 + index * 7).padStart(2, '0')}`),
    viewers: count,
    expectedViewers: expected,
    status: 'aired',
  }));
}

/** Mainstage on a national TV network, beating its expectations; a weekly PPV deal at risk; a deal the network ended. */
export const galleryDealRows: readonly DealRow[] = [
  {
    dealId: TV_DEAL,
    networkId: parseId('network', 'net_0000000101'),
    networkName: 'National Sports Network',
    kind: 'tv',
    logoRef: null,
    showName: 'Mainstage',
    eventDefinitionId: parseId('eventDefinition', 'evd_0000000101'),
    weekday: 0,
    timeslot: 'primeTime',
    live: true,
    terms: {
      feePerShow: cents(13_770_000),
      perThousandViewers: cents(500),
      costPerShow: cents(521_500),
    },
    startsOn: parseGameDate('2026-01-05'),
    endsOn: parseGameDate('2027-10-04'),
    daysLeft: 269,
    status: 'active',
    endedReason: null,
    lastAiring: {
      airDate: parseGameDate('2027-01-04'),
      viewers: 2_412_300,
      expectedViewers: 1_903_000,
      traceRef: airingTraceRef({ id: TV_AIRING }, true),
    },
    expectedViewers: counted(
      'What National Sports Network expects',
      1_903_000,
      'A typical promotion in prime time',
    ),
    recent: recent([2_210_000, 2_350_500, 2_298_000, 2_412_300], 1_903_000),
    targets: targets(1_903_000),
    risk: 'exceeding',
    riskReasons: [
      "Beating the network's expectations: viewers are 127% of what National Sports Network expects",
    ],
    healthTraceRef: dealHealthTraceRef(TV_DEAL),
    upcomingMissed: [],
  },
  {
    dealId: PPV_DEAL,
    networkId: parseId('network', 'net_0000000102'),
    networkName: 'Turnstile PPV',
    kind: 'ppv',
    logoRef: null,
    showName: 'All major shows',
    eventDefinitionId: null,
    weekday: null,
    timeslot: 'primeTime',
    live: true,
    terms: {
      feePerShow: cents(0),
      perThousandViewers: cents(180_000),
      costPerShow: cents(22_896_000),
    },
    startsOn: parseGameDate('2026-06-01'),
    endsOn: parseGameDate('2028-06-01'),
    daysLeft: 510,
    status: 'active',
    endedReason: null,
    lastAiring: null,
    expectedViewers: counted('What Turnstile PPV expects', 150_000, 'A typical major show'),
    targets: targets(150_000),
    recent: [],
    risk: 'atRisk',
    riskReasons: [
      'Missed airing coming: Sat 30 Jan',
      'Viewers are 71% of what Turnstile PPV expects',
    ],
    healthTraceRef: null,
    upcomingMissed: [parseGameDate('2027-01-30')],
  },
  {
    dealId: ENDED_DEAL,
    networkId: parseId('network', 'net_0000000103'),
    networkName: 'Bluebonnet Cable 7',
    kind: 'tv',
    logoRef: null,
    showName: 'Hardpan Friday',
    eventDefinitionId: parseId('eventDefinition', 'evd_0000000103'),
    weekday: 4,
    timeslot: 'evening',
    live: false,
    terms: {
      feePerShow: cents(30_000),
      perThousandViewers: cents(500),
      costPerShow: cents(69_000),
    },
    startsOn: parseGameDate('2026-01-09'),
    endsOn: parseGameDate('2026-11-20'),
    daysLeft: 0,
    status: 'cancelled',
    endedReason: 'lowViewers',
    lastAiring: null,
    expectedViewers: null,
    targets: null,
    recent: [],
    risk: null,
    riskReasons: [],
    healthTraceRef: null,
    upcomingMissed: [],
  },
];

/** The stand-in breakdowns the rows point at, for the gallery's trace transport. */
export function galleryNetworkTraces(): StoredTraceEntry[] {
  return [
    {
      ref: airingTraceRef({ id: TV_AIRING }, true),
      date: parseGameDate('2027-01-04'),
      seq: 1,
      value: 13_770_000,
      trace: money('Net from the airing', 13_770_000, 'Fee and viewers less airtime').trace,
    },
    {
      ref: dealHealthTraceRef(TV_DEAL),
      date: parseGameDate('2027-01-04'),
      seq: 2,
      value: 'exceeding',
      trace: note('National Sports Network’s view of the deal', [
        "Beating the network's expectations: viewers are 127% of what National Sports Network expects",
        'No missed airings',
      ]),
    },
  ];
}

function valuation(
  verdict: 'accept' | 'refuse',
  options: {
    readonly viewers: number;
    readonly benchmark: number;
    readonly fee: number;
    readonly perThousand: number;
    readonly cost: number;
  },
): DealValuation {
  const income =
    options.fee + Math.round((options.perThousand * options.viewers) / 1000) - options.cost;
  const refusals =
    verdict === 'accept'
      ? []
      : [
          {
            code: 'timeslotNotAllowed' as const,
            message: 'Prime time needs a reach of 25.0; yours is 12.4',
          },
          {
            code: 'cameraTooLow' as const,
            message:
              'National Sports Network needs camera level 4; yours is 2. Raise your camera level in Production',
          },
          {
            code: 'audienceTooSmall' as const,
            message: 'Your audience would be about 41% of what the network needs (85%)',
          },
        ];
  return {
    verdict,
    refusals,
    projectedViewers: counted('Projected viewers', options.viewers, 'Fans who would watch'),
    benchmark: counted('What the network expects', options.benchmark, 'A typical promotion'),
    ratio: counted('Viewers against what it expects', options.viewers / options.benchmark, 'Ratio'),
    terms: {
      feePerShow: money('Fee per show', options.fee, 'Flat fee'),
      perThousandViewers: money('Paid per thousand viewers', options.perThousand, 'Rate'),
      costPerShow: money('Airtime per show', options.cost, 'Airtime rate'),
    },
    incomePerAiring: money('Income per airing', income, 'Fee and viewers less airtime'),
    importance: 'regular',
    weekday: 4,
    startsOn: GALLERY_NETWORKS_TODAY,
    endsOn: parseGameDate('2029-01-08'),
    becomesTelevised: false,
    renewalUplift: null,
    targets: targets(options.benchmark),
    verdictTrace: note(verdict === 'accept' ? 'Would accept' : 'Would refuse', [
      ...refusals.map((refusal) => refusal.message),
      verdict === 'accept' ? 'Every check passes' : 'The network says no',
    ]),
  };
}

/** A small regional network that signs, though airtime costs more than it pays: loses money. */
export const galleryAcceptedValuation: DealValuation = valuation('accept', {
  viewers: 3_962,
  benchmark: 1_616,
  fee: 30_000,
  perThousand: 500,
  cost: 69_000,
});

/**
 * A national network that refuses: prime time is out of reach, the camera is too low (with the
 * link to Production) and the audience too small.
 */
export const galleryRefusedValuation: DealValuation = valuation('refuse', {
  viewers: 48_300,
  benchmark: 117_800,
  fee: 0,
  perThousand: 500,
  cost: 9_000,
});

/** A pay-per-view proposal: paid per buy, with the high pay-per-view airtime. */
export const galleryPpvValuation: DealValuation = valuation('accept', {
  viewers: 152_000,
  benchmark: 150_000,
  fee: 0,
  perThousand: 180_000,
  cost: 22_896_000,
});

export const galleryIncomeSummary: BroadcastIncomeSummary = {
  total: 55_080_000,
  trace: startCalc('TV, pay-per-view and streaming money, last 30 days', 0, {
    unit: 'money',
    startLabel: 'Nothing yet',
  })
    .add('Mainstage on National Sports Network', 55_080_000)
    .done().trace,
  lastAiring: {
    showName: 'Mainstage',
    viewers: 2_412_300,
    expectedViewers: 1_903_000,
    airDate: parseGameDate('2027-01-04'),
  },
  note: null,
};
