// Shared worlds for the aftermath engine's tests (MTCH3-03).
import { parseGameDate } from '../../../../src/core/date';
import type {
  EmploymentId,
  EventInstanceId,
  PersonId,
  RegionId,
  SegmentId,
} from '../../../../src/core/ids';
import { refKey } from '../../../../src/core/trace/store';
import type { Traced, TraceValue } from '../../../../src/core/trace';
import type { GameWorld } from '../../../../src/model/tables';
import { applySegmentAftermath, type AppliedAftermath } from '../../../../src/systems/match';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import type { DoorContext } from '../../../../src/systems/workers';
import { aPerson } from '../../../support/builders/people';
import { TEST_PLAYER_ID } from '../../../support/builders/build-row';
import { testId } from '../../../support/ids';
import { worldBuilder, type CompletedMatch } from '../../../support/world-builder';

/** The mini map: neighbours run in a line, North 1 - North 2 - South 1 - South 2. */
export const NORTH_1 = testId('region', 1);
export const NORTH_2 = testId('region', 2);
export const SOUTH_1 = testId('region', 3);
export const SOUTH_2 = testId('region', 4);
export const REGIONS = [NORTH_1, NORTH_2, SOUTH_1, SOUTH_2] as const;

export const SHOW_DATE = parseGameDate('2026-02-04');
const FORMAT = { slots: 6, preShowSlots: 1 };

export interface AftermathWorldOptions {
  /** Each roster member's popularity in every region; the roster has this many workers. */
  readonly popularity: readonly number[];
  readonly matches: readonly Omit<CompletedMatch, 'show'>[];
  /** Where the show is held. North 2 (two neighbours) by default. */
  readonly showRegion?: RegionId;
  /** Adds one worker with no contract, at index `popularity.length`, with this popularity. */
  readonly freeAgentPopularity?: number;
}

export interface AftermathWorld {
  readonly world: GameWorld;
  readonly show: EventInstanceId;
  person(index: number): PersonId;
  employment(index: number): EmploymentId;
  segment(index: number): SegmentId;
}

function everywhere(value: number): Record<RegionId, number> {
  return Object.fromEntries(REGIONS.map((region) => [region, value])) as Record<RegionId, number>;
}

/**
 * A human-run promotion whose wrestlers have charisma 90 (no taper below 90 popularity) and
 * momentum 0, one completed show in `showRegion` and the given run matches on it.
 */
export function aftermathWorld(options: AftermathWorldOptions): AftermathWorld {
  let builder = worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
      promotion.withRoster(options.popularity.length, {
        person: (index) => ({
          attributes: { charisma: 90 },
          regionalPop: everywhere(options.popularity[index] ?? 0),
        }),
        employment: () => ({ momentum: 0 }),
      }),
    );
  const freeAgent = options.freeAgentPopularity;
  if (freeAgent !== undefined) {
    builder = builder.with('free agent', (context) => {
      context.insert(
        'people',
        aPerson(
          { attributes: { charisma: 90 }, regionalPop: everywhere(freeAgent) },
          context.sequence,
        ),
      );
    });
  }
  builder = builder.withEventInstance({
    date: SHOW_DATE,
    status: 'completed',
    format: FORMAT,
    regionId: options.showRegion ?? NORTH_2,
  });
  for (const match of options.matches) {
    builder = builder.withCompletedMatch({ ...match, show: 0 });
  }
  const { world, ids } = builder.build();
  const pick = <T>(list: readonly T[], index: number, what: string): T => {
    const value = list[index];
    if (value === undefined) {
      throw new Error(`aftermathWorld has no ${what} ${String(index)}`);
    }
    return value;
  };
  return {
    world,
    show: pick(ids.eventInstances, 0, 'show'),
    person: (index) => pick(ids.people, index, 'person'),
    employment: (index) => pick(ids.employments, index, 'employment'),
    segment: (index) => pick(ids.segments, index, 'segment'),
  };
}

export interface PublishedEvent {
  readonly type: string;
  readonly payload: unknown;
}

export interface ApplyRun {
  readonly results: readonly AppliedAftermath[];
  readonly events: readonly PublishedEvent[];
  /** Recorded traces by `refKey`. */
  readonly traces: ReadonlyMap<string, Traced<TraceValue>>;
}

/** Applies the segments' aftermaths in order inside one transaction, as show night would. */
export function applyInOrder(
  world: GameWorld,
  segmentIds: readonly SegmentId[],
  tunables: EngineTunables = createEngineTunables(),
): ApplyRun {
  const events: PublishedEvent[] = [];
  const traces = new Map<string, Traced<TraceValue>>();
  const results: AppliedAftermath[] = [];
  const outcome = world.transact('apply aftermaths', (tx) => {
    const step: DoorContext = {
      date: SHOW_DATE,
      tx,
      read: tx.view,
      tunables,
      publish: (type, payload) => {
        events.push({ type, payload });
      },
      recordTrace: (ref, _date, traced) => {
        traces.set(refKey(ref), traced);
      },
    };
    for (const segmentId of segmentIds) {
      results.push(applySegmentAftermath(step, segmentId));
    }
  });
  if (!outcome.ok) {
    throw outcome.error;
  }
  return { results, events, traces };
}
