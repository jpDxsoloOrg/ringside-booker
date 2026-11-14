/**
 * The aftermath of one match, worked out without writing anything (MTCH3-03).
 *
 * For every competitor: the popularity change in the show's region (`popularityGain`), how the
 * popularity door would spread it over the show region, its neighbours and any reached region
 * (`segmentRegionWeights` and `previewPopularityChange`, with the door's taper, clamp and rounding),
 * the country and continent roll-ups before and after, and the momentum change with the show's
 * promotion (`momentumGain` and `previewMomentumChange`).
 *
 * The same code serves the Match lab's Simulate (a match on no show) and show night's applier (a
 * stored segment, read through the transaction so earlier segments' writes are visible). Every
 * competitor is worked out from the values **before this match**: a winner's gain never changes
 * the loser's comparison, and in a tag match one partner's gain never changes the other's.
 *
 * Nothing here reads or changes morale (D-09).
 *
 * Design: docs/design/match-aftermath.md#the-aftermath-of-one-match.
 */

import type { ContentKey } from '../../../core/content-key';
import type { GameDate } from '../../../core/date';
import type {
  ContinentId,
  CountryId,
  EmploymentId,
  EventInstanceId,
  PersonId,
  PromotionId,
  RegionId,
  SegmentId,
} from '../../../core/ids';
import { inputOf, startCalc, type Traced, type TraceNode } from '../../../core/trace';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { Employment } from '../../../model/entities/employment';
import type { MatchOutcome } from '../../../model/entities/segment';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { sidesOf } from '../../shows/context';
import type { EngineTunables } from '../../tunables';
import {
  initialMomentum,
  previewMomentumChange,
  previewPopularityChange,
  type PopularityPreview,
} from '../../workers/doors';
import type { Geography } from '../../world/geography';
import { popularityRollup } from '../../world/formulas/popularityRollup';
import { momentumGain, noContractMomentum, type MomentumOpponent } from './formulas/momentumGain';
import {
  popularityGain,
  type PopularityFinish,
  type PopularityOpponent,
} from './formulas/popularityGain';
import { resultOf, winStreakBefore, type MatchPosition, type MatchResultForSide } from './history';
import { segmentRegionWeights, type RegionWeightLine } from './regionWeights';

export const AFTERMATH_DOC_REF = 'docs/design/match-aftermath.md#the-aftermath-of-one-match';

/** A match on no show, as the Match lab simulates it. */
export interface SimulatedAftermathInput {
  readonly promotionId: PromotionId;
  readonly date: GameDate;
  readonly regionId: RegionId;
  readonly televised: boolean;
  readonly importance: EventImportance;
  readonly preShow: boolean;
  /** The competitors of each side; the index is the stored 0-based side. */
  readonly sides: readonly (readonly PersonId[])[];
  readonly outcome: MatchOutcome;
  readonly finishKey: ContentKey | null;
  /** The segment score 0..100, or null when it was not rated. */
  readonly score: number | null;
}

/** A stored segment (show night), or a simulated match (the lab). */
export type AftermathInput = { readonly segmentId: SegmentId } | SimulatedAftermathInput;

/** One region the change reaches, before and after. */
export interface AftermathRegionRow {
  readonly regionId: RegionId;
  readonly name: string;
  /** `show`, `neighbour` or a reach provider's id. */
  readonly source: string;
  readonly reason: string;
  readonly weight: number;
  readonly before: number;
  readonly after: number;
  readonly change: number;
  /** How `after` is worked out: change × weight, tapered above the anchor, clamped and rounded. */
  readonly trace: TraceNode;
}

/** A country or continent that holds a changed region: its roll-up before and after. */
export interface AftermathRollupRow<Id extends string> {
  readonly id: Id;
  readonly name: string;
  readonly before: number;
  readonly after: number;
  readonly change: number;
  /** "After roll-up − before roll-up", each with its population-weighted mean. */
  readonly trace: TraceNode;
}

export interface AftermathPopularity {
  /** The change in the show's region, before the spread and taper: `popularityGain`'s result. */
  readonly delta: Traced<number>;
  readonly regions: readonly AftermathRegionRow[];
  readonly countries: readonly AftermathRollupRow<CountryId>[];
  readonly continents: readonly AftermathRollupRow<ContinentId>[];
}

export interface AftermathMomentum {
  readonly employmentId: EmploymentId;
  /** Momentum before; for a first appearance, the momentum the door starts it from. */
  readonly before: number;
  /** True when the contract had no momentum yet and the door would start it. */
  readonly started: boolean;
  readonly after: number;
  readonly change: number;
  /** `momentumGain`'s result: the change asked for. */
  readonly delta: Traced<number>;
  /** The door's trace: momentum before, the change and the −100..100 limit. */
  readonly trace: TraceNode;
}

/** A competitor with no contract with the show's promotion: no momentum to change. */
export interface AftermathNoMomentum {
  readonly none: 'noContract';
}

export interface AftermathWorker {
  readonly personId: PersonId;
  readonly name: string;
  /** The stored 0-based side. */
  readonly side: number;
  readonly outcome: MatchResultForSide;
  /** "Beat Kara Voss", "Lost to Rex Harlan and Vic Moreno", "Drew with ...", "No contest". */
  readonly resultLine: string;
  readonly popularity: AftermathPopularity;
  readonly momentum: AftermathMomentum | AftermathNoMomentum;
}

/** The aftermath of one match, as plain JSON. */
export interface SegmentAftermath {
  /** Null for a simulated match. */
  readonly segmentId: SegmentId | null;
  readonly eventInstanceId: EventInstanceId | null;
  readonly showRegionId: RegionId;
  readonly showRegionName: string;
  /** Where the change goes, one line per region. */
  readonly weights: readonly RegionWeightLine[];
  /** What the spread adjusted on the way (a reach weight outside 0..1, an unknown region). */
  readonly notes: readonly string[];
  /** Side order, then person id. Empty for an angle or a match with no result. */
  readonly workers: readonly AftermathWorker[];
}

/** True when the worker's momentum would change (they have a contract with the promotion). */
export function hasMomentum(
  momentum: AftermathMomentum | AftermathNoMomentum,
): momentum is AftermathMomentum {
  return !('none' in momentum);
}

/** The match in the shape both inputs share. */
interface ResolvedMatch {
  readonly segmentId: SegmentId | null;
  readonly eventInstanceId: EventInstanceId | null;
  readonly promotionId: PromotionId;
  readonly date: GameDate;
  readonly regionId: RegionId;
  readonly televised: boolean;
  readonly importance: EventImportance;
  readonly preShow: boolean;
  readonly slot: number;
  readonly sides: readonly { readonly side: number; readonly competitorIds: readonly PersonId[] }[];
  /** Null for an angle or a match with no result: nobody is affected. */
  readonly outcome: DeepReadonly<MatchOutcome> | null;
  readonly finishKey: ContentKey | null;
  readonly score: number | null;
}

function isStored(input: AftermathInput): input is { readonly segmentId: SegmentId } {
  return 'segmentId' in input;
}

function resolveMatch(read: GameWorldView, input: AftermathInput): ResolvedMatch {
  if (!isStored(input)) {
    return {
      segmentId: null,
      eventInstanceId: null,
      promotionId: input.promotionId,
      date: input.date,
      regionId: input.regionId,
      televised: input.televised,
      importance: input.importance,
      preShow: input.preShow,
      slot: 0,
      sides: input.sides
        .map((competitorIds, side) => ({ side, competitorIds }))
        .filter((side) => side.competitorIds.length > 0),
      outcome: input.outcome,
      finishKey: input.finishKey,
      score: input.score,
    };
  }
  const segment = read.tables.segments.require(input.segmentId);
  const instance = read.tables.eventInstances.require(segment.eventInstanceId);
  const definition =
    instance.eventDefinitionId === null
      ? undefined
      : read.tables.eventDefinitions.get(instance.eventDefinitionId);
  const isMatch = segment.kind === 'match';
  return {
    segmentId: segment.id,
    eventInstanceId: instance.id,
    promotionId: instance.promotionId,
    date: instance.date,
    regionId: instance.regionId,
    televised: definition?.televised ?? false,
    importance: instance.importance,
    preShow: segment.preShow,
    slot: segment.slot,
    sides: isMatch
      ? sidesOf(segment, read.tables.participants.lookup('bySegment', segment.id))
          .filter((side) => side.competitorIds.length > 0)
          .map((side) => ({ side: side.side, competitorIds: side.competitorIds }))
      : [],
    outcome: isMatch ? segment.outcome : null,
    finishKey: isMatch ? segment.match.finishKey : null,
    score: segment.rating?.score ?? null,
  };
}

/** The person's active employment with the promotion, if any: where their momentum lives. */
function activeEmploymentWith(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
): DeepReadonly<Employment> | undefined {
  return read.tables.employments
    .lookup('byPerson', personId)
    .find((employment) => employment.status === 'active' && employment.promotionId === promotionId);
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? 'nobody';
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** What one competitor's result reads like, in plain words. */
function resultLineOf(outcome: MatchResultForSide, opponentNames: readonly string[]): string {
  switch (outcome) {
    case 'win':
      return `Beat ${listNames(opponentNames)}`;
    case 'loss':
      return `Lost to ${listNames(opponentNames)}`;
    case 'draw':
      return `Drew with ${listNames(opponentNames)}`;
    case 'noContest':
      return 'No contest';
  }
}

/** Everything about one competitor read before the match, shared by every worker's comparison. */
interface Competitor {
  readonly personId: PersonId;
  readonly name: string;
  readonly side: number;
  readonly popularity: number;
  readonly employment: DeepReadonly<Employment> | undefined;
  /** Momentum with the promotion: stored, started, or 0 with no contract. */
  readonly momentum: Traced<number>;
}

function readCompetitor(
  read: GameWorldView,
  tunables: EngineTunables,
  match: ResolvedMatch,
  personId: PersonId,
  side: number,
): Competitor {
  const person = read.tables.people.require(personId);
  const employment = activeEmploymentWith(read, personId, match.promotionId);
  const name = employment?.ringName ?? person.defaultRingName;
  let momentum: Traced<number>;
  if (employment === undefined) {
    momentum = noContractMomentum(name);
  } else if (employment.momentum === null) {
    momentum = initialMomentum(read, employment, tunables);
  } else {
    momentum = inputOf(`${name}'s momentum`, employment.momentum, {
      kind: 'employment',
      id: employment.id,
    });
  }
  return {
    personId,
    name,
    side,
    popularity: person.regionalPop[match.regionId] ?? 0,
    employment,
    momentum,
  };
}

function finishOf(read: GameWorldView, finishKey: ContentKey | null): PopularityFinish | null {
  if (finishKey === null) {
    return null;
  }
  const finish = read.meta.catalogs.finishes?.[finishKey];
  if (finish === undefined) {
    return null;
  }
  return { name: finish.name, winnerFactor: finish.gains.winner, loserFactor: finish.gains.loser };
}

/** The roll-up rows of the countries and continents that hold a changed region. */
function rollupRows(
  geography: Geography,
  before: Readonly<Partial<Record<RegionId, number>>>,
  after: Readonly<Partial<Record<RegionId, number>>>,
  changed: readonly RegionId[],
): Pick<AftermathPopularity, 'countries' | 'continents'> {
  if (changed.length === 0) {
    return { countries: [], continents: [] };
  }
  const countryIds = new Set<CountryId>(changed.map((id) => geography.countryOf(id).id));
  const continentIds = new Set<ContinentId>(changed.map((id) => geography.continentOf(id).id));
  const beforeRollup = popularityRollup(before, geography);
  const afterRollup = popularityRollup(after, geography);
  const row = <Id extends string>(
    id: Id,
    name: string,
    beforeValue: Traced<number> | undefined,
    afterValue: Traced<number> | undefined,
  ): AftermathRollupRow<Id> => {
    const start = afterValue ?? inputOf('Popularity after this match', 0);
    const end = beforeValue ?? inputOf('Popularity before this match', 0);
    const change = startCalc(`Change in ${name}`, start, { unit: 'points' })
      .subtract('Popularity before this match', end)
      .done();
    return {
      id,
      name,
      before: end.value,
      after: start.value,
      change: change.value,
      trace: change.trace,
    };
  };
  return {
    countries: geography.countries
      .filter((country) => countryIds.has(country.id))
      .map((country) =>
        row(
          country.id,
          country.name,
          beforeRollup.countries.get(country.id),
          afterRollup.countries.get(country.id),
        ),
      ),
    continents: geography.continents
      .filter((continent) => continentIds.has(continent.id))
      .map((continent) =>
        row(
          continent.id,
          continent.name,
          beforeRollup.continents.get(continent.id),
          afterRollup.continents.get(continent.id),
        ),
      ),
  };
}

/** The per-region and roll-up part of a competitor's popularity change. */
export type PopularityDetail = Pick<AftermathPopularity, 'regions' | 'countries' | 'continents'>;

export const NO_REGION_DETAIL: PopularityDetail = Object.freeze({
  regions: [],
  countries: [],
  continents: [],
});

/** Each region's line of the door's preview, and the country and continent roll-ups around it. */
export function popularityDetail(
  geography: Geography,
  lines: readonly RegionWeightLine[],
  preview: PopularityPreview,
): PopularityDetail {
  const regions = lines.map((line): AftermathRegionRow => {
    const region = preview.regions.get(line.regionId);
    const before = region?.before ?? 0;
    const after = region?.after ?? before;
    return {
      regionId: line.regionId,
      name: line.name,
      source: line.source,
      reason: line.reason,
      weight: line.weight,
      before,
      after,
      change: after - before,
      trace: region?.trace.trace ?? inputOf('Popularity', before).trace,
    };
  });
  return {
    regions,
    ...rollupRows(geography, preview.before, preview.after, preview.regionsChanged),
  };
}

/** Options for {@link computeSegmentAftermath}. */
export interface AftermathOptions {
  /**
   * Work out the per-region preview and the country and continent roll-ups of each competitor's
   * popularity change (`regions`, `countries`, `continents`). True by default. Show night's
   * applier turns it off (POL4-09): the popularity door works the regions out again when it
   * writes, and nothing it stores reads the roll-ups, which were most of a show night's time.
   * With it off those three lists are empty; every other field is the same.
   */
  readonly regionDetail?: boolean;
}

/**
 * The aftermath of one match for every competitor, from the world as it stands. Reads only; uses
 * no RNG. An angle, or a match with no result yet, has no workers.
 */
export function computeSegmentAftermath(
  read: GameWorldView,
  input: AftermathInput,
  tunables: EngineTunables,
  geography: Geography,
  options: AftermathOptions = {},
): SegmentAftermath {
  const regionDetail = options.regionDetail !== false;
  const match = resolveMatch(read, input);
  const showRegion = read.tables.regions.require(match.regionId);
  const spread = segmentRegionWeights(
    read,
    {
      promotionId: match.promotionId,
      eventInstanceId: match.eventInstanceId,
      regionId: match.regionId,
      televised: match.televised,
      importance: match.importance,
      date: match.date,
    },
    tunables,
  );
  const base = {
    segmentId: match.segmentId,
    eventInstanceId: match.eventInstanceId,
    showRegionId: showRegion.id,
    showRegionName: showRegion.name,
    weights: spread.lines,
    notes: spread.notes,
  };
  const { outcome } = match;
  if (outcome === null) {
    return { ...base, workers: [] };
  }

  // Everyone is read before anyone's change is worked out.
  const competitors = match.sides.flatMap((side) =>
    [...side.competitorIds]
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((personId) => readCompetitor(read, tunables, match, personId, side.side)),
  );
  const winningSide = outcome.kind === 'win' ? outcome.winningSide : null;
  const finish = finishOf(read, match.finishKey);
  const regionWeights = Object.fromEntries(spread.weights) as Record<RegionId, number>;
  const lookback = tunables.get('match.popularity.streakLookback');
  const position: MatchPosition = {
    date: match.date,
    eventInstanceId: match.eventInstanceId,
    preShow: match.preShow,
    slot: match.slot,
    segmentId: match.segmentId,
  };
  const popularityOf = (competitor: Competitor): Traced<number> =>
    inputOf(`${competitor.name}'s popularity in ${showRegion.name}`, competitor.popularity, {
      kind: 'person',
      id: competitor.personId,
    });

  const workers = competitors.map((competitor): AftermathWorker => {
    const result = resultOf({ outcome }, competitor.side);
    const others = competitors.filter((other) => other.side !== competitor.side);
    // MTCH3-01's rule: everyone beaten for a win, the winners for a loss, everyone else otherwise.
    const measuredAgainst =
      result === 'loss' ? others.filter((other) => other.side === winningSide) : others;
    const opponents: PopularityOpponent[] = measuredAgainst.map((other) => ({
      name: other.name,
      popularity: popularityOf(other),
    }));
    const streak = winStreakBefore(read, competitor.personId, position, lookback);
    const storedMomentum = competitor.employment?.momentum ?? null;
    const delta = popularityGain(
      {
        outcome: result,
        popularity: popularityOf(competitor),
        opponents,
        importance: match.importance,
        finish,
        competitorCount: competitors.length,
        segmentScore: match.score,
        preShow: match.preShow,
        priorWinStreak: streak.streak,
        momentum: storedMomentum === null ? null : competitor.momentum,
      },
      { tunables },
    );
    const resultLine = resultLineOf(
      result,
      measuredAgainst.map((other) => other.name),
    );
    const detail = regionDetail
      ? popularityDetail(
          geography,
          spread.lines,
          previewPopularityChange(
            read,
            tunables,
            { kind: 'person', id: competitor.personId },
            { regionWeights, delta, label: resultLine },
          ),
        )
      : NO_REGION_DETAIL;

    let momentum: AftermathMomentum | AftermathNoMomentum = { none: 'noContract' };
    if (competitor.employment !== undefined) {
      const opponentsMomentum: MomentumOpponent[] = others.map((other) => ({
        name: other.name,
        momentum: other.momentum,
        won: other.side === winningSide,
      }));
      const momentumDelta = momentumGain(
        {
          outcome: result,
          momentum: competitor.momentum,
          opponents: opponentsMomentum,
          sides: match.sides.length,
          segmentScore: match.score,
        },
        { tunables },
      );
      const door = previewMomentumChange(
        read,
        tunables,
        competitor.employment.id,
        momentumDelta,
        resultLine,
      );
      momentum = {
        employmentId: competitor.employment.id,
        before: competitor.momentum.value,
        started: door.before === null,
        after: door.after,
        change: door.after - competitor.momentum.value,
        delta: momentumDelta,
        trace: door.trace.trace,
      };
    }

    return {
      personId: competitor.personId,
      name: competitor.name,
      side: competitor.side,
      outcome: result,
      resultLine,
      popularity: { delta, ...detail },
      momentum,
    };
  });
  return { ...base, workers };
}
