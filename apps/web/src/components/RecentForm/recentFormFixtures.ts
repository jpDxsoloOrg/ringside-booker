/**
 * Made-up recent-form rows for the gallery and RecentForm's tests: a five-win streak, a mixed run
 * with a draw and a no contest, and rows whose changes are no longer known.
 */
import { parseGameDate, parseId } from '@ringside/engine';
import type { MatchResultForSide, PersonId } from '@ringside/engine';
import type { RecentFormItem } from './RecentForm';

const OPPONENTS: readonly { readonly personId: PersonId; readonly name: string }[] = [
  { personId: parseId('person', 'per_0000000011'), name: 'Kara Voss' },
  { personId: parseId('person', 'per_0000000012'), name: 'Rex Harlan' },
  { personId: parseId('person', 'per_0000000013'), name: 'Vic Moreno' },
  { personId: parseId('person', 'per_0000000014'), name: 'Dee Lux' },
];

const EVENTS = ['Altura Mainstage', 'Altura Uprising', 'Coastline Clash'] as const;

interface ItemSpec {
  readonly result: MatchResultForSide;
  readonly popularity: number | null;
  readonly momentum: number | null;
  /** How many opponents, 1 by default. */
  readonly opponents?: number;
  /** False when the full breakdown has been pruned. */
  readonly traced?: boolean;
}

/** `first` numbers the segments, so rows from two fixtures never share an id. */
function itemsOf(specs: readonly ItemSpec[], first: number): RecentFormItem[] {
  return specs.map((spec, index) => {
    const segmentId = parseId('segment', `seg_00000000${String(first + index)}`);
    const traced = spec.traced ?? true;
    const opponentCount = spec.opponents ?? 1;
    return {
      segmentId,
      // Newest first, a week apart.
      date: parseGameDate(`2027-01-${String(30 - index * 7).padStart(2, '0')}`),
      eventName: EVENTS[index % EVENTS.length] ?? EVENTS[0],
      result: spec.result,
      opponents: Array.from(
        { length: opponentCount },
        (_, offset) => OPPONENTS[(index + offset) % OPPONENTS.length] ?? OPPONENTS[0],
      ).filter((opponent) => opponent !== undefined),
      popularityChange: spec.popularity,
      momentumChange: spec.momentum,
      traceRefs: {
        popularity:
          traced && spec.popularity !== null
            ? { kind: 'match.popularityGain', id: `${segmentId}/per_0000000001` }
            : null,
        momentum:
          traced && spec.momentum !== null
            ? { kind: 'match.momentumGain', id: `${segmentId}/per_0000000001` }
            : null,
      },
    };
  });
}

/** Five wins in a row. */
export function winStreakForm(): RecentFormItem[] {
  return itemsOf(
    [
      { result: 'win', popularity: 1.4, momentum: 6 },
      { result: 'win', popularity: 2.6, momentum: 10 },
      { result: 'win', popularity: 0.8, momentum: 5 },
      { result: 'win', popularity: 1, momentum: 5 },
      { result: 'win', popularity: 3.1, momentum: 12 },
    ],
    10,
  );
}

/** A win, a loss, a draw, a no contest and a four-way loss. */
export function mixedForm(): RecentFormItem[] {
  return itemsOf(
    [
      { result: 'win', popularity: 2.6, momentum: 10 },
      { result: 'loss', popularity: -0.5, momentum: -5 },
      { result: 'draw', popularity: 0.02, momentum: -2 },
      { result: 'noContest', popularity: null, momentum: null },
      { result: 'loss', popularity: -0.3, momentum: -3, opponents: 3 },
    ],
    20,
  );
}

/** Older matches whose row was pruned, or whose breakdown is no longer kept. */
export function unknownChangesForm(): RecentFormItem[] {
  return itemsOf(
    [
      { result: 'win', popularity: 1.2, momentum: 5, traced: false },
      { result: 'loss', popularity: null, momentum: null },
      { result: 'win', popularity: 0.9, momentum: null, traced: false },
    ],
    30,
  );
}
