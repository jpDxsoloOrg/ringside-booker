// Shared setup for the rating pipeline tests (MTCH1-05): the tiny world's segments as rating
// inputs, a rate helper that fails on a refusal, and small world edits.
import { expect } from 'vitest';
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import type { PersonId, SegmentId } from '../../../../src/core/ids';
import { findTraceNodes, type Traced, type TraceNode } from '../../../../src/core/trace';
import { isAngle, isMatch, type Segment } from '../../../../src/model/entities/segment';
import type { Person } from '../../../../src/model/entities/person';
import type { GameWorld } from '../../../../src/model/tables';
import {
  MATCH_RATING_STREAM,
  rateSegment,
  ratingInputFromSegment,
  type SegmentRatingInput,
  type SegmentRatingResult,
} from '../../../../src/systems/match';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { tinyWorld } from '../../../support/worlds';

export const DEFAULT_TUNABLES = createEngineTunables();

export interface TinyRating {
  readonly world: GameWorld;
  /** The title match: people[0] against people[1], main-card slot 3 of 6. */
  readonly mainEvent: Segment;
  /** The two-speaker promo: people[0] against people[1]. */
  readonly promo: Segment;
  readonly people: readonly PersonId[];
}

/** The tiny world with its title match and promo picked out. */
export function tinyRating(): TinyRating {
  const { world, ids } = tinyWorld();
  const segments = world.tables.segments.values();
  const mainEvent = segments.find(
    (segment) => isMatch(segment) && segment.match.titleIds.length > 0,
  );
  const promo = segments.find((segment) => isAngle(segment));
  if (mainEvent === undefined || promo === undefined) {
    throw new Error('tinyWorld has no title match or promo');
  }
  return { world, mainEvent, promo, people: ids.people };
}

/** The rating input for a stored segment. */
export function inputOf(world: GameWorld, segmentId: SegmentId): SegmentRatingInput {
  return ratingInputFromSegment(world, segmentId);
}

/** A fresh `match.rating` stream for `seed`. */
export function ratingStream(seed = 'rating-test'): RngStream {
  return new RngRegistry(seed).stream(MATCH_RATING_STREAM);
}

/** Rates `input` and fails the test on a refusal. No rolls unless `rng` is given. */
export function rate(
  world: GameWorld,
  input: SegmentRatingInput,
  options: { tunables?: EngineTunables; rng?: RngStream } = {},
): SegmentRatingResult {
  const result = rateSegment(input, {
    read: world,
    tunables: options.tunables ?? DEFAULT_TUNABLES,
    ...(options.rng === undefined ? {} : { rng: options.rng }),
  });
  if (!result.ok) {
    expect.fail(`rateSegment refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

/** Every node labelled `label` anywhere in the trace. */
export function nodesLabelled(value: Traced<unknown>, label: string): TraceNode[] {
  const found: TraceNode[] = [];
  const visit = (node: TraceNode): void => {
    if (node.label === label) {
      found.push(node);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(value.trace);
  return found;
}

/** The direct steps of a formula trace labelled `label`. */
export function stepsLabelled(value: Traced<unknown>, label: string): TraceNode[] {
  return (value.trace.children ?? []).filter((node) => node.label === label);
}

/** Every `add` node in the trace labelled `label`. */
export function addsLabelled(value: Traced<unknown>, label: string): TraceNode[] {
  return findTraceNodes(value.trace, 'add').filter((node) => node.label === label);
}

/** Rewrites one person in place. */
export function updatePerson(
  world: GameWorld,
  personId: PersonId,
  change: (person: Person) => Person,
): void {
  const result = world.transact('edit person', (tx) => {
    tx.update('people', personId, change);
  });
  if (!result.ok) {
    throw result.error;
  }
}

/** Sets a person's momentum on their contract with promotion A. */
export function setMomentum(world: GameWorld, personId: PersonId, momentum: number | null): void {
  const contract = world.tables.employments
    .lookup('byPerson', personId)
    .find((employment) => employment.status === 'active');
  if (contract === undefined) {
    throw new Error(`no active contract for ${personId}`);
  }
  const result = world.transact('edit contract', (tx) => {
    tx.update('employments', contract.id, { momentum });
  });
  if (!result.ok) {
    throw result.error;
  }
}

/** A person id the tiny world is known to have. */
export function personAt(people: readonly PersonId[], index: number): PersonId {
  const id = people[index];
  if (id === undefined) {
    throw new Error(`tinyWorld has no person ${String(index)}`);
  }
  return id;
}
