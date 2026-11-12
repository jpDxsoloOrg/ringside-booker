// MTCH2 on show night (EVT3-07): the registered match outcome resolver. Design:
// docs/design/match-finishes.md#integration and show-night.md#match-outcome-resolver.
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import type { SegmentId } from '../../../src/core/ids';
import type { SimRuntime } from '../../../src/core/pipeline/runtime';
import { walkTrace, type TraceNode } from '../../../src/core/trace';
import type { Segment } from '../../../src/model/entities/segment';
import {
  MATCH_OUTCOME_RESOLVER_ID,
  RANDOM_WINNERS_SET_ASIDE_NOTE,
  BOOKED_NO_CONTEST_REASON,
} from '../../../src/systems/match';
import {
  MATCH_RESULT_TRACE_KIND,
  RIVAL_MATCH_RESULT_TRACE_KIND,
  matchOutcomeResolver,
  titleOutcomeTraceRef,
} from '../../../src/systems/shows';
import { promo, seed, singles } from '../booking/command-world';
import {
  OMNISCIENT,
  segmentEvents,
  showNightEngine,
  showNightWorld,
} from '../shows/show-night-world';
import {
  competitor,
  defendedEvents,
  changedEvents,
  member,
  runNight,
  titleMatch,
  titleNightWorld,
  winFor,
  type TitleNightWorld,
} from '../shows/title-night-world';

const DISQUALIFICATION = parseContentKey('method.disqualification');
const PINFALL = parseContentKey('method.pinfall');

function segmentOf(built: TitleNightWorld, id: SegmentId): Segment {
  return built.world.tables.segments.require(id);
}

function matchOf(segment: Segment) {
  if (segment.kind !== 'match') {
    throw new Error(`${segment.id} is not a match`);
  }
  return segment;
}

function completedEvents(runtime: SimRuntime) {
  return runtime.bus
    .recent({ limit: 1000, types: ['segment.completed'] })
    .map((event) => event.payload);
}

function storedTrace(runtime: SimRuntime, kind: string, id: string): TraceNode {
  const entry = runtime.traces.get({ kind, id });
  if (entry === undefined || !('trace' in entry)) {
    throw new Error(`No full trace ${kind}:${id}`);
  }
  return entry.trace;
}

/** Every label and decision reason in a trace. */
function textsIn(node: TraceNode): string[] {
  const texts: string[] = [];
  walkTrace(node, (visited) => {
    texts.push(visited.label);
    if (visited.kind === 'decision') {
      texts.push(visited.reason);
    }
  });
  return texts;
}

/** A singles world-title match: the champion (roster 0) on side 0 against roster 1. */
function worldTitleMatch(built: TitleNightWorld, outcome: Parameters<typeof titleMatch>[1]) {
  return seed(
    built.world,
    built.show,
    0,
    titleMatch([competitor(member(built, 0), 0), competitor(member(built, 1), 1)], outcome, [
      built.titles.world,
    ]),
  );
}

describe('MTCH2 on show night', () => {
  it('is the registered match outcome resolver', () => {
    expect(matchOutcomeResolver().id).toBe(MATCH_OUTCOME_RESOLVER_ID);
  });

  it('keeps the reign open with a defence when the challenger wins by disqualification', () => {
    const built = titleNightWorld();
    const before = built.world.tables.titleReigns.lookupOne('openByTitle', built.titles.world);
    const segmentId = worldTitleMatch(built, winFor(1, DISQUALIFICATION));
    const { runtime } = runNight(built);

    const segment = matchOf(segmentOf(built, segmentId));
    expect(segment.outcome).toEqual(winFor(1, DISQUALIFICATION));
    expect(segment.match.finishKey).toBe('finish.disqualification');
    const after = built.world.tables.titleReigns.lookupOne('openByTitle', built.titles.world);
    expect(after).toMatchObject({ id: before?.id, defences: (before?.defences ?? 0) + 1 });
    expect(changedEvents(runtime)).toEqual([]);
    expect(defendedEvents(runtime)).toHaveLength(1);

    const decision = storedTrace(
      runtime,
      'shows.titleOutcome',
      titleOutcomeTraceRef(segmentId, built.titles.world).id,
    );
    expect(decision).toMatchObject({
      chosen: 'retained',
      reason: "Disqualification: titles can't change hands on this finish",
    });
    expect(completedEvents(runtime)).toEqual([
      expect.objectContaining({
        segmentId,
        finishKey: 'finish.disqualification',
        methodKey: DISQUALIFICATION,
      }),
    ]);
  });

  it('moves the title on a clean challenger win, with the finish on segment.completed', () => {
    const built = titleNightWorld();
    const segmentId = worldTitleMatch(built, winFor(1, PINFALL));
    const { runtime } = runNight(built);

    const segment = matchOf(segmentOf(built, segmentId));
    const finishKey = segment.match.finishKey;
    expect(finishKey).not.toBeNull();
    expect(completedEvents(runtime)[0]?.finishKey).toBe(finishKey);
    // Every finish that ends by pinfall allows a title change.
    expect(changedEvents(runtime)).toHaveLength(1);
    const result = storedTrace(runtime, MATCH_RESULT_TRACE_KIND, segmentId);
    expect(result).toMatchObject({ kind: 'decision', label: 'Match result', value: 'Side 2 wins' });
  });

  it('gives every unplanned match on a rival card a winner, not a no contest', async () => {
    const built = showNightWorld();
    const engine = showNightEngine(built.world);
    await engine.advanceDays({ maxDays: 1 });
    const state = engine.exportState();

    const events = segmentEvents(engine).filter(
      (event) => event.eventInstanceId === built.rivalCard,
    );
    expect(events).toHaveLength(built.rivalMatches.length);
    for (const segmentId of built.rivalMatches) {
      const segment = state.world.tables.segments.find((row) => row.id === segmentId);
      expect(segment?.kind === 'match' ? segment.outcome?.kind : null).toBe('win');
      expect(segment?.kind === 'match' ? segment.match.finishKey : null).not.toBeNull();
      const event = events.find((entry) => entry.segmentId === segmentId);
      expect(event?.winnerIds).toHaveLength(1);
      expect(event?.loserIds).toHaveLength(1);
      expect(event?.finishKey).not.toBeNull();

      const found = engine.query(
        'trace.get',
        { ref: { kind: RIVAL_MATCH_RESULT_TRACE_KIND, id: segmentId } },
        OMNISCIENT,
      );
      expect(found.ok && found.data !== null).toBe(true);
    }
  });

  it('keeps a booked no contest and picks a no-contest finish for it', () => {
    const built = titleNightWorld();
    const segmentId = seed(
      built.world,
      built.show,
      0,
      singles(member(built, 4), member(built, 5), { kind: 'noContest' }),
    );
    const { runtime } = runNight(built);

    const segment = matchOf(segmentOf(built, segmentId));
    expect(segment.outcome).toEqual({ kind: 'noContest' });
    expect(segment.match.finishKey).toBe('finish.no-contest');
    expect(textsIn(storedTrace(runtime, MATCH_RESULT_TRACE_KIND, segmentId))).toContain(
      BOOKED_NO_CONTEST_REASON,
    );
  });

  it('keeps the booked winner when the booked finish does not fit, and says why', () => {
    const built = titleNightWorld();
    const segmentId = seed(
      built.world,
      built.show,
      0,
      singles(member(built, 4), member(built, 5), winFor(0)),
    );
    // A draw finish booked on a win: the finish is set aside, the winner kept.
    const written = built.world.transact('book a draw finish', (tx) => {
      tx.update('segments', segmentId, (previous) =>
        previous.kind === 'match'
          ? {
              ...previous,
              match: { ...previous.match, finishKey: parseContentKey('finish.stalemate') },
            }
          : previous,
      );
    });
    expect(written.ok).toBe(true);
    const { runtime } = runNight(built);

    const segment = matchOf(segmentOf(built, segmentId));
    expect(segment.outcome).toMatchObject({ kind: 'win', winningSide: 0 });
    expect(segment.match.finishKey).not.toBe('finish.stalemate');
    const texts = textsIn(storedTrace(runtime, MATCH_RESULT_TRACE_KIND, segmentId));
    expect(texts.some((text) => text.startsWith("The booked finish couldn't be used"))).toBe(true);
  });

  describe('in a Random winners game', () => {
    it('decides a booked result on the night and says so', () => {
      const built = titleNightWorld({ randomWinners: true });
      const segmentId = seed(
        built.world,
        built.show,
        0,
        singles(member(built, 4), member(built, 5), winFor(0)),
      );
      const { runtime } = runNight(built);

      const segment = matchOf(segmentOf(built, segmentId));
      expect(segment.outcome?.kind).toBe('win');
      const texts = textsIn(storedTrace(runtime, MATCH_RESULT_TRACE_KIND, segmentId));
      expect(texts).toContain(RANDOM_WINNERS_SET_ASIDE_NOTE);
      expect(texts.some((text) => text.startsWith('Random winners mode'))).toBe(true);
    });

    it('gives an unplanned match on your show a winner', () => {
      const built = titleNightWorld({ randomWinners: true });
      const segmentId = seed(
        built.world,
        built.show,
        0,
        singles(member(built, 4), member(built, 5), null),
      );
      seed(built.world, built.show, 1, promo(member(built, 6)));
      const { runtime } = runNight(built);

      const segment = matchOf(segmentOf(built, segmentId));
      expect(segment.outcome?.kind).toBe('win');
      expect(segment.match.finishKey).not.toBeNull();
      const texts = textsIn(storedTrace(runtime, MATCH_RESULT_TRACE_KIND, segmentId));
      expect(texts).not.toContain(RANDOM_WINNERS_SET_ASIDE_NOTE);
      const event = completedEvents(runtime).find((entry) => entry.segmentId === segmentId);
      expect(event?.winnerIds).toHaveLength(1);
    });
  });
});
