/**
 * Audience: how many people watch a show on a network (or, on pay-per-view, how many buy it). One
 * formula for everything that needs viewers: what a network will pay (valuation), what it expects
 * (the benchmark), what an airing drew, and the same for rivals as for the player.
 *
 * audience = Σ region audiences (each region the network covers, see `regionAudience`)
 *            × reach tier factor × kind factor × timeslot factor
 *            × (1 + marketing level × marketingPerLevel)
 *            × live bonus (only when live)
 *            × importance factor × hype multiplier × quality factor
 *            × night-to-night swing (airings only)
 * rounded down to whole viewers.
 *
 * Pay-per-view always uses the prime-time factor (it is not tied to a timeslot). The quality factor
 * is 1 + (show score − neutral score) × qualityPerPoint, never below 0. There are no minutes or
 * durations anywhere (D-10): show quality is the show score.
 *
 * The Why? groups the regions by country, biggest audience first, and folds the smallest countries
 * into one line, so a world-wide network's trace stays inside the trace limits.
 *
 * Design: docs/design/broadcast.md#audience.
 */

import { InvalidArgumentError } from '../../../core/errors';
import type { RngStream } from '../../../core/rng/registry';
import { rollFloat } from '../../../core/rng/rolls';
import { inputOf, startCalc, type Traced } from '../../../core/trace';
import { compactTrace } from '../../../core/trace/compact';
import { countTraceNodes, fitTraceNode } from '../../../core/trace/limits';
import type { DealTimeslot } from '../../../model/entities/deal';
import type { EventImportance } from '../../../model/entities/event-definition';
import { NETWORK_REACH_TIER_MAX, type NetworkKind } from '../../../model/entities/network';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { AUDIENCE_DOC_REF, regionAudience, type RegionAudienceInputs } from './regionAudience';

export { AUDIENCE_DOC_REF } from './regionAudience';

/** One region of a network's coverage, with the country it is listed under in the Why?. */
export interface RegionAudienceInput extends RegionAudienceInputs {
  readonly countryName: string;
}

/** How good the show was, for the quality factor. */
export interface AudienceQuality {
  /** The show score, 0..100. */
  readonly score: number;
  /** `show` for a show's real score; `neutral` when there is none yet. */
  readonly source: 'show' | 'neutral';
  /** Why the quality is neutral, shown in the Why?. */
  readonly note?: string;
}

/** The importances a show on a network can have: a house show never airs. */
export type AudienceImportance = Exclude<EventImportance, 'house'>;

export interface AudienceInputs {
  readonly regions: readonly RegionAudienceInput[];
  readonly networkName: string;
  /** The network's reach tier, 0 (local) to 4 (global). */
  readonly reachTier: number;
  readonly kind: NetworkKind;
  readonly timeslot: DealTimeslot;
  /** Aired live rather than taped. */
  readonly live: boolean;
  readonly importance: EventImportance;
  /** The promotion's marketing level, 0..10. */
  readonly marketingLevel: number;
  /** The hype multiplier, or null while hype isn't tracked. */
  readonly hype: Traced<number> | null;
  /** The show's quality, or null when there is no show result. */
  readonly quality: AudienceQuality | null;
  /** Roll the night-to-night swing (airings only; valuation and the benchmark never roll). */
  readonly swing: boolean;
}

/**
 * The most countries listed one by one in an audience's Why?; the rest share one "Other countries"
 * line. Keeps world-wide networks under `TRACE_MAX_NODES`.
 */
export const AUDIENCE_TRACE_COUNTRY_LINES = 12;

/**
 * The most trace nodes the "who could watch" line may hold. When the regions' full working does not
 * fit, each region keeps only its number (its own Why? is the region formula), and anything still
 * over is cut with an "N more steps not shown" note. Leaves room under `TRACE_MAX_NODES` for every
 * multiplier line after it.
 */
export const AUDIENCE_TRACE_COVERAGE_NODES = 300;

/** The most trace nodes the hype line may hold, for the same reason. */
export const AUDIENCE_TRACE_HYPE_NODES = 40;

export const PPV_TIMESLOT_NOTE = "Pay-per-view isn't tied to a timeslot";
export const NO_HYPE_NOTE = "Hype isn't tracked yet";
export const NEUTRAL_QUALITY_NOTE = 'No show result yet: neutral quality';
export const TAPED_NOTE = 'Taped: no live bonus';
export const SWING_LABEL = 'Night-to-night swing';

const TIER_KEYS = [
  'broadcast.audience.tier0',
  'broadcast.audience.tier1',
  'broadcast.audience.tier2',
  'broadcast.audience.tier3',
  'broadcast.audience.tier4',
] as const satisfies readonly NumberTunableKey[];

const KIND_KEYS = {
  tv: 'broadcast.audience.kind.tv',
  ppv: 'broadcast.audience.kind.ppv',
  streaming: 'broadcast.audience.kind.streaming',
} as const satisfies Readonly<Record<NetworkKind, NumberTunableKey>>;

const KIND_LABELS: Readonly<Record<NetworkKind, string>> = {
  tv: 'TV channel',
  ppv: 'Pay-per-view buyers',
  streaming: 'Streaming service',
};

const TIMESLOT_KEYS = {
  daytime: 'broadcast.audience.timeslot.daytime',
  evening: 'broadcast.audience.timeslot.evening',
  primeTime: 'broadcast.audience.timeslot.primeTime',
  lateNight: 'broadcast.audience.timeslot.lateNight',
} as const satisfies Readonly<Record<DealTimeslot, NumberTunableKey>>;

const TIMESLOT_LABELS: Readonly<Record<DealTimeslot, string>> = {
  daytime: 'Daytime',
  evening: 'Evening',
  primeTime: 'Prime time',
  lateNight: 'Late night',
};

const IMPORTANCE_KEYS = {
  minor: 'broadcast.audience.importance.minor',
  regular: 'broadcast.audience.importance.regular',
  major: 'broadcast.audience.importance.major',
  flagship: 'broadcast.audience.importance.flagship',
} as const satisfies Readonly<Record<AudienceImportance, NumberTunableKey>>;

const IMPORTANCE_LABELS: Readonly<Record<AudienceImportance, string>> = {
  minor: 'Minor show',
  regular: 'Regular show',
  major: 'Major show',
  flagship: 'Flagship show',
};

/** Level of a step's child in the root's trace: root, step, child. */
const STEP_CHILD_DEPTH = 3;

/** "2,104,000": whole viewers with thousands separators, the same on every machine. */
export function formatViewers(value: number): string {
  return String(Math.floor(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A traced value with its trace cut to `maxNodes`, the value untouched. */
function fitted(value: Traced<number>, maxNodes: number): Traced<number> {
  return { value: value.value, trace: fitTraceNode(value.trace, STEP_CHILD_DEPTH, maxNodes).node };
}

interface CountryAudience {
  readonly name: string;
  readonly order: number;
  readonly regions: { readonly name: string; readonly audience: Traced<number> }[];
  total: number;
}

/** Largest first; ties in the order the regions were given. */
function byAudience<T extends { readonly order: number }>(
  value: (item: T) => number,
): (left: T, right: T) => number {
  return (left, right) => value(right) - value(left) || left.order - right.order;
}

/** One country's line: its regions' audiences added up, biggest first. */
function countryLine(country: CountryAudience, detailed: boolean): Traced<number> {
  const calc = startCalc(`Audience in ${country.name}`, 0, { unit: 'count', startLabel: 'Start' });
  for (const region of country.regions) {
    // Without detail a region keeps its number and a note in place of its working.
    calc.add(region.name, detailed ? region.audience : compactTrace(region.audience, 1));
  }
  return calc.done();
}

function countryLines(
  countries: readonly CountryAudience[],
  unknownRegions: number,
  detailed: boolean,
): Traced<number> {
  const calc = startCalc('Who could watch', 0, { unit: 'count', startLabel: 'Start' });
  const listed = countries.slice(0, AUDIENCE_TRACE_COUNTRY_LINES);
  const folded = countries.slice(AUDIENCE_TRACE_COUNTRY_LINES);
  for (const country of listed) {
    calc.add(`${country.name}: ${formatViewers(country.total)}`, countryLine(country, detailed));
  }
  if (folded.length > 0) {
    const label = `Other countries (${String(folded.length)})`;
    const other = startCalc(label, 0, { unit: 'count', startLabel: 'Start' });
    for (const country of folded) {
      other.add(`${country.name}: ${formatViewers(country.total)}`, country.total);
    }
    calc.add(label, other.done());
  }
  if (unknownRegions > 0) {
    calc.note(
      unknownRegions === 1
        ? 'No popularity in 1 region'
        : `No popularity in ${String(unknownRegions)} regions`,
    );
  }
  return calc.done();
}

/**
 * Everyone the network could reach, before its own factors: each region's audience, grouped by
 * country. Regions where nobody knows the promotion add nothing and share one note.
 */
function coverageAudience(
  regions: readonly RegionAudienceInput[],
  tunables: EngineTunables,
): Traced<number> {
  const countries = new Map<string, CountryAudience>();
  let unknownRegions = 0;
  for (const region of regions) {
    if (region.popularity <= 0) {
      unknownRegions += 1;
      continue;
    }
    const audience = regionAudience(region, { tunables });
    let country = countries.get(region.countryName);
    if (country === undefined) {
      country = {
        name: region.countryName,
        order: countries.size,
        regions: [],
        total: 0,
      };
      countries.set(region.countryName, country);
    }
    country.regions.push({ name: region.regionName, audience });
    country.total += audience.value;
  }
  const sorted = [...countries.values()].sort(byAudience((country) => country.total));
  for (const country of sorted) {
    const order = new Map(country.regions.map((region, index) => [region, index]));
    country.regions.sort(
      (left, right) =>
        right.audience.value - left.audience.value ||
        (order.get(left) ?? 0) - (order.get(right) ?? 0),
    );
  }
  const detailed = countryLines(sorted, unknownRegions, true);
  const lines =
    countTraceNodes(detailed.trace) > AUDIENCE_TRACE_COVERAGE_NODES
      ? countryLines(sorted, unknownRegions, false)
      : detailed;
  return fitted(lines, AUDIENCE_TRACE_COVERAGE_NODES);
}

function marketingFactor(level: number, tunables: EngineTunables): Traced<number> {
  const calc = startCalc(
    `Marketing level ${formatNumber(level)}`,
    inputOf('Marketing level', level, undefined, 'count'),
    { unit: 'multiplier' },
  );
  calc.multiply(
    'Viewers added per level',
    calc.tunable(tunables, 'broadcast.audience.marketingPerLevel', 'Viewers added per level'),
  );
  calc.add('Without marketing', 1, 'With no marketing the audience is unchanged');
  return calc.done();
}

function qualityFactor(score: number, tunables: EngineTunables): Traced<number> {
  // EVT3's show score is the slot-weighted mean of the segment scores (show-night.md#show-score).
  const calc = startCalc(
    `Show score ${formatNumber(score)} (slot-weighted)`,
    inputOf('Show score', score, undefined, 'points'),
    { unit: 'multiplier' },
  );
  calc.subtract(
    'Neutral score',
    calc.tunable(tunables, 'broadcast.audience.neutralQuality', 'Neutral score'),
  );
  calc.multiply(
    'Viewers per point',
    calc.tunable(tunables, 'broadcast.audience.qualityPerPoint', 'Viewers per point'),
  );
  calc.add('At the neutral score', 1, 'A show at the neutral score keeps the audience unchanged');
  calc.max('Never below 0', 0);
  return calc.done();
}

function requireTier(reachTier: number): (typeof TIER_KEYS)[number] {
  const key = Number.isInteger(reachTier) ? TIER_KEYS[reachTier] : undefined;
  if (key === undefined) {
    throw new InvalidArgumentError(
      'audience',
      'reachTier',
      reachTier,
      `a whole number from 0 to ${String(NETWORK_REACH_TIER_MAX)}`,
    );
  }
  return key;
}

/** The viewers (or pay-per-view buyers), a whole number, 0 or more. Rolls only when `swing`. */
export function audience(
  inputs: AudienceInputs,
  deps: { readonly tunables: EngineTunables; readonly rng?: RngStream },
): Traced<number> {
  const { tunables } = deps;
  const { importance } = inputs;
  if (importance === 'house') {
    throw new InvalidArgumentError(
      'audience',
      'importance',
      importance,
      'a televised importance (house shows never air)',
    );
  }
  const tierKey = requireTier(inputs.reachTier);
  const rng = deps.rng;
  if (inputs.swing && rng === undefined) {
    throw new InvalidArgumentError('audience', 'deps.rng', rng, 'a stream when swing is on');
  }

  const calc = startCalc(
    inputs.kind === 'ppv' ? `Buys on ${inputs.networkName}` : `Viewers on ${inputs.networkName}`,
    coverageAudience(inputs.regions, tunables),
    { unit: 'count', docRef: AUDIENCE_DOC_REF },
  );
  calc.multiply(
    `Reach tier ${String(inputs.reachTier)}`,
    calc.tunable(tunables, tierKey, `Reach tier ${String(inputs.reachTier)}`),
  );
  calc.multiply(
    KIND_LABELS[inputs.kind],
    calc.tunable(tunables, KIND_KEYS[inputs.kind], KIND_LABELS[inputs.kind]),
  );
  const timeslot: DealTimeslot = inputs.kind === 'ppv' ? 'primeTime' : inputs.timeslot;
  if (inputs.kind === 'ppv') {
    calc.note(PPV_TIMESLOT_NOTE);
  }
  calc.multiply(
    TIMESLOT_LABELS[timeslot],
    calc.tunable(tunables, TIMESLOT_KEYS[timeslot], TIMESLOT_LABELS[timeslot]),
  );
  calc.multiply(
    `Marketing level ${formatNumber(inputs.marketingLevel)}`,
    marketingFactor(inputs.marketingLevel, tunables),
  );
  if (inputs.live) {
    calc.multiply('Live', calc.tunable(tunables, 'broadcast.audience.liveBonus', 'Live bonus'));
  } else {
    calc.note(TAPED_NOTE);
  }
  calc.multiply(
    IMPORTANCE_LABELS[importance],
    calc.tunable(tunables, IMPORTANCE_KEYS[importance], IMPORTANCE_LABELS[importance]),
  );
  if (inputs.hype === null) {
    calc.note(NO_HYPE_NOTE);
    calc.multiply('Hype', 1, NO_HYPE_NOTE);
  } else {
    calc.multiply('Hype', fitted(inputs.hype, AUDIENCE_TRACE_HYPE_NODES));
  }
  const quality = inputs.quality;
  if (quality === null || quality.source === 'neutral') {
    const note = quality?.note ?? NEUTRAL_QUALITY_NOTE;
    calc.note(note);
    calc.multiply('Show quality', 1, note);
  } else {
    calc.multiply('Show quality', qualityFactor(quality.score, tunables));
  }
  if (inputs.swing && rng !== undefined) {
    const spread = calc.tunable(tunables, 'broadcast.airing.viewerSwing', SWING_LABEL);
    const night = rollFloat(rng, 1 - spread, 1 + spread, SWING_LABEL);
    calc.roll(night.roll);
    calc.multiply(SWING_LABEL, night.value);
  }
  calc.round('floor', 'Rounded down to whole viewers');
  return calc.done();
}
