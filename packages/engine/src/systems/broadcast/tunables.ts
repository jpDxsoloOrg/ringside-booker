/**
 * The broadcast system's balance numbers (ECO8). ECO8-01 adds the one key its helpers read: how
 * popular a promotion must be in a region before that region's networks are listed for it. ECO8-02
 * adds the audience formula's factors and the network benchmark's reference promotion. Each later
 * ECO8 ticket appends its own keys here, in the `Broadcast` category.
 *
 * Documented in docs/design/broadcast.md and docs/design/tunables.md#broadcast-tunables.
 */

import { defineTunables } from '../../core/tunables/define';

export const BROADCAST_TUNABLE_CATEGORY = 'Broadcast';
export const BROADCAST_DOC = 'broadcast.md';
const AUDIENCE_DOC_REF = `${BROADCAST_DOC}#audience`;
const BENCHMARK_DOC_REF = `${BROADCAST_DOC}#benchmark`;
const VALUATION_DOC_REF = `${BROADCAST_DOC}#valuation`;
const SETTLEMENT_DOC_REF = `${BROADCAST_DOC}#settlement`;

/** A factor of the audience formula: a plain ratio where 0 means nobody watches. */
function audienceRatio(defaultValue: number, max: number, description: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max,
    unit: 'ratio',
    category: BROADCAST_TUNABLE_CATEGORY,
    description: `${description}; 0 means 0 (nobody watches)`,
    docRef: AUDIENCE_DOC_REF,
  } as const;
}

/** The popularity the network benchmark's typical promotion has everywhere, for one reach tier. */
function benchmarkPopularity(tier: number, defaultValue: number) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: 100,
    unit: 'points',
    category: BROADCAST_TUNABLE_CATEGORY,
    description: `Popularity of the typical promotion a tier-${String(tier)} network expects, in every region it covers; 0 means the network expects nobody`,
    docRef: BENCHMARK_DOC_REF,
  } as const;
}

/** A valuation rate or cost in cents (ECO8-03); 0 means 0. */
function valuationMoney(defaultValue: number, max: number, description: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: 0,
    max,
    unit: 'money',
    category: BROADCAST_TUNABLE_CATEGORY,
    description: `${description}, in cents; 0 means 0`,
    docRef: VALUATION_DOC_REF,
  } as const;
}

/** The smallest audience a network of one kind will put on air (ECO8-03). */
function minimumAudience(kindLabel: string, defaultValue: number) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: 0,
    max: 1_000_000,
    unit: 'count',
    category: BROADCAST_TUNABLE_CATEGORY,
    description: `Fewest projected viewers (buyers on pay-per-view) ${kindLabel} will take; 0 means no floor`,
    docRef: VALUATION_DOC_REF,
  } as const;
}

/** A deal length in months (ECO8-03). */
function dealMonths(defaultValue: number, description: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: 1,
    max: 120,
    unit: 'months',
    category: BROADCAST_TUNABLE_CATEGORY,
    description,
    docRef: VALUATION_DOC_REF,
  } as const;
}

export const broadcastTunables = defineTunables({
  'broadcast.networks.minPopularityToList': {
    kind: 'integer',
    default: 1,
    min: 0,
    max: 100,
    unit: 'points',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      'Popularity a promotion needs in a region before the networks covering it are listed for the promotion; 0 lists every network in the world',
    docRef: `${BROADCAST_DOC}#which-networks-a-promotion-can-deal-with`,
  },
  'broadcast.audience.baseShare': audienceRatio(
    0.012,
    1,
    'Share of the people who care about wrestling that a fully popular promotion draws on a top network',
  ),
  'broadcast.audience.popularityPower': {
    kind: 'number',
    default: 1.5,
    min: 0.5,
    max: 4,
    unit: 'ratio',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      'How sharply popularity turns into viewers: popularity out of 100 is raised to this power; 1 is a straight line',
    docRef: AUDIENCE_DOC_REF,
  },
  'broadcast.audience.tier0': audienceRatio(
    0.3,
    1,
    'Share of the audience a tier-0 (local) network reaches',
  ),
  'broadcast.audience.tier1': audienceRatio(
    0.4,
    1,
    'Share of the audience a tier-1 (regional) network reaches',
  ),
  'broadcast.audience.tier2': audienceRatio(
    0.55,
    1,
    'Share of the audience a tier-2 network reaches',
  ),
  'broadcast.audience.tier3': audienceRatio(
    0.75,
    1,
    'Share of the audience a tier-3 network reaches',
  ),
  'broadcast.audience.tier4': audienceRatio(
    1,
    1,
    'Share of the audience a tier-4 (top) network reaches',
  ),
  'broadcast.audience.kind.tv': audienceRatio(
    1,
    1,
    'Share of the audience a TV channel turns into viewers',
  ),
  'broadcast.audience.kind.ppv': audienceRatio(
    0.05,
    1,
    'Share of the audience that buys a pay-per-view (it counts buyers, not viewers)',
  ),
  'broadcast.audience.kind.streaming': audienceRatio(
    0.25,
    1,
    'Share of the audience a streaming service turns into viewers',
  ),
  'broadcast.audience.timeslot.daytime': audienceRatio(
    0.35,
    1,
    'Share of the audience watching in the daytime',
  ),
  'broadcast.audience.timeslot.evening': audienceRatio(
    0.7,
    1,
    'Share of the audience watching in the evening',
  ),
  'broadcast.audience.timeslot.primeTime': audienceRatio(
    1,
    1,
    'Share of the audience watching in prime time',
  ),
  'broadcast.audience.timeslot.lateNight': audienceRatio(
    0.25,
    1,
    'Share of the audience watching late at night',
  ),
  'broadcast.audience.importance.minor': audienceRatio(
    0.6,
    3,
    'Viewers a minor show draws, against a regular show',
  ),
  'broadcast.audience.importance.regular': audienceRatio(1, 3, 'Viewers a regular show draws'),
  'broadcast.audience.importance.major': audienceRatio(
    1.4,
    3,
    'Viewers a major show draws, against a regular show',
  ),
  'broadcast.audience.importance.flagship': audienceRatio(
    1.8,
    3,
    'Viewers a flagship show draws, against a regular show',
  ),
  'broadcast.audience.marketingPerLevel': {
    kind: 'number',
    default: 0.04,
    min: 0,
    max: 0.2,
    unit: 'ratio',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      'Viewers added by each marketing level, as a share of the audience; 0 means marketing adds nobody',
    docRef: AUDIENCE_DOC_REF,
  },
  'broadcast.audience.liveBonus': {
    kind: 'number',
    default: 1.05,
    min: 1,
    max: 2,
    unit: 'multiplier',
    category: BROADCAST_TUNABLE_CATEGORY,
    description: 'Viewers a live show draws against a taped one; 1 means live draws no more',
    docRef: AUDIENCE_DOC_REF,
  },
  'broadcast.audience.neutralQuality': {
    kind: 'number',
    default: 50,
    min: 0,
    max: 100,
    unit: 'points',
    category: BROADCAST_TUNABLE_CATEGORY,
    description: 'Show score that neither adds nor loses viewers',
    docRef: AUDIENCE_DOC_REF,
  },
  'broadcast.audience.qualityPerPoint': {
    kind: 'number',
    default: 0.006,
    min: 0,
    max: 0.05,
    unit: 'ratio',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      'Viewers gained or lost for each show score point above or below the neutral score, as a share of the audience; 0 means show quality changes nothing',
    docRef: AUDIENCE_DOC_REF,
  },
  'broadcast.airing.viewerSwing': {
    kind: 'number',
    default: 0.05,
    min: 0,
    max: 0.5,
    unit: 'ratio',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      "How far an airing's viewers can swing either way from night to night; 0 means no swing",
    docRef: AUDIENCE_DOC_REF,
  },
  'broadcast.benchmark.popularity.tier0': benchmarkPopularity(0, 10),
  'broadcast.benchmark.popularity.tier1': benchmarkPopularity(1, 15),
  'broadcast.benchmark.popularity.tier2': benchmarkPopularity(2, 16),
  'broadcast.benchmark.popularity.tier3': benchmarkPopularity(3, 48),
  'broadcast.benchmark.popularity.tier4': benchmarkPopularity(4, 58),
  'broadcast.benchmark.marketingLevel': {
    kind: 'integer',
    default: 5,
    min: 0,
    max: 10,
    unit: 'count',
    category: BROADCAST_TUNABLE_CATEGORY,
    description: 'Marketing level of the typical promotion a network expects',
    docRef: BENCHMARK_DOC_REF,
  },
  // ECO8-03: what a network pays and what it accepts.
  // ECO8-09: TV and streaming rates and airtime are an eighth of ECO8-03's, so TV covers about a
  // big promotion's monthly overhead rather than all of its costs; pay-per-view is unchanged.
  'broadcast.value.tvPerThousand': valuationMoney(
    5_000,
    100_000_000,
    'What a TV channel pays for each thousand viewers it values',
  ),
  'broadcast.value.streamingPerThousand': valuationMoney(
    3_125,
    100_000_000,
    'What a streaming service pays for each thousand viewers it values',
  ),
  'broadcast.value.ppvPerThousandBuys': valuationMoney(
    180_000,
    100_000_000,
    'What a pay-per-view provider pays for each thousand buys',
  ),
  'broadcast.value.tvBonusShare': {
    kind: 'number',
    default: 0.1,
    min: 0,
    max: 1,
    unit: 'ratio',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      'Part of the TV rate paid per thousand actual viewers instead of as a flat fee; 0 means all of it is the flat fee',
    docRef: VALUATION_DOC_REF,
  },
  'broadcast.value.liveFeeBonus': {
    kind: 'number',
    default: 1.1,
    min: 1,
    max: 3,
    unit: 'multiplier',
    category: BROADCAST_TUNABLE_CATEGORY,
    description: 'What a network pays more for a live show than a taped one; 1 means no more',
    docRef: VALUATION_DOC_REF,
  },
  'broadcast.value.valuedViewersCap': {
    kind: 'number',
    default: 5,
    min: 0,
    max: 10,
    unit: 'ratio',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      'Most viewers a network pays the flat fee for, as a share of what it expects; 0 means it pays no flat fee',
    docRef: VALUATION_DOC_REF,
  },
  'broadcast.value.airtimePerMillion': valuationMoney(
    1_875,
    100_000_000,
    'Airtime a TV channel or streaming service charges for each million people it covers, for each reach tier step',
  ),
  'broadcast.value.ppvAirtimePerMillion': valuationMoney(
    15_000,
    100_000_000,
    'Airtime a pay-per-view provider charges for each million people it covers, for each reach tier step',
  ),
  'broadcast.value.streamingAirtimeFactor': {
    kind: 'number',
    default: 0.1,
    min: 0,
    max: 1,
    unit: 'ratio',
    category: BROADCAST_TUNABLE_CATEGORY,
    description: 'Share of the airtime cost a streaming service charges; 0 means it charges none',
    docRef: VALUATION_DOC_REF,
  },
  'broadcast.deal.minBenchmarkRatio': {
    kind: 'number',
    default: 0.85,
    min: 0,
    max: 5,
    unit: 'ratio',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      'Share of what a network expects that a promotion must draw before it will sign; 0 means any audience will do',
    docRef: VALUATION_DOC_REF,
  },
  'broadcast.deal.minViewers.tv': minimumAudience('a TV channel', 1_000),
  'broadcast.deal.minViewers.ppv': minimumAudience('a pay-per-view provider', 300),
  'broadcast.deal.minViewers.streaming': minimumAudience('a streaming service', 300),
  'broadcast.deal.cameraPerTier': {
    kind: 'integer',
    default: 1,
    min: 0,
    max: 10,
    unit: 'count',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      'Camera level a network needs for each step of its reach tier; 0 means any camera will do',
    docRef: VALUATION_DOC_REF,
  },
  'broadcast.deal.primeTimeMinReach': {
    kind: 'number',
    default: 25,
    min: 0,
    max: 100,
    unit: 'points',
    category: BROADCAST_TUNABLE_CATEGORY,
    description: 'Reach a promotion needs before a network gives it prime time; 0 means anyone',
    docRef: VALUATION_DOC_REF,
  },
  'broadcast.deal.minMonths': dealMonths(6, 'Shortest deal a network will sign'),
  'broadcast.deal.maxMonths': dealMonths(48, 'Longest deal a network will sign'),
  'broadcast.deal.defaultMonths': dealMonths(24, 'Deal length offered when the player picks none'),
  // ECO8-04: settling airings.
  'broadcast.shares.maxTotal': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    unit: 'ratio',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      "Most of an airing's income that workers' broadcast shares can take in total; 0 means workers get no share",
    docRef: SETTLEMENT_DOC_REF,
  },
  'broadcast.airing.historyDays': {
    kind: 'integer',
    default: 400,
    min: 30,
    max: 3650,
    unit: 'days',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      "How long the player's airings are kept; older ones are deleted (the money stays in the ledger)",
    docRef: SETTLEMENT_DOC_REF,
  },
  'broadcast.airing.keepPerDeal': {
    kind: 'integer',
    default: 12,
    min: 1,
    max: 100,
    unit: 'count',
    category: BROADCAST_TUNABLE_CATEGORY,
    description:
      "Newest airings of each deal kept whatever their age, so deal health always has its window; must be at least deal health's window",
    docRef: SETTLEMENT_DOC_REF,
  },
});
