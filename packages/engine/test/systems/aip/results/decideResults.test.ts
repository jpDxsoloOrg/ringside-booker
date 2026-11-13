// Rival results inside aip.bookShow (AIP5-04). Design:
// docs/design/rival-booking.md#how-a-rival-shows-results-are-decided
import { describe, expect, it } from 'vitest';
import { controllerViewer, OMNISCIENT_VIEWER } from '../../../../src/core/api/controller';
import { createEngine, initialEngineState, type Engine } from '../../../../src/core/api';
import { addDays, type GameDate } from '../../../../src/core/date';
import type {
  EventInstanceId,
  PersonId,
  PromotionId,
  SegmentId,
  TitleId,
} from '../../../../src/core/ids';
import type { EngineState } from '../../../../src/core/api';
import type { MatchSegment } from '../../../../src/model/entities/segment';
import type { SerializedWorld } from '../../../../src/persistence/save-document';
import {
  REIGN_BAND_NUMBERS,
  reignBandChanceKey,
  TITLE_CHANGE_SUMMARY_KEY,
  TITLE_DECISION_KIND,
  TITLE_TRACE_KIND,
  WINNER_DECISION_KIND,
  WINNER_TRACE_KIND,
  winPlanKey,
  WINNERS_BOOKED_SUMMARY_KEY,
} from '../../../../src/systems/aip';
import { aMatch, anEventInstance, aParticipant } from '../../../support/builders/creative';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../../support/builders/build-row';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../../support/systems';
import { SLOW_TESTS } from '../../../support/slow';
import { expectSerialisable } from '../../../support/trace';
import { worldBuilder } from '../../../support/world-builder';

type Tables = SerializedWorld['tables'];

const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const COMPUTER = { kind: 'computer' } as const;
const HUMAN_VIEWER = controllerViewer(HUMAN);
/** The first rival show: two days after the (Monday) start. */
const SHOW_DAY: GameDate = addDays(TEST_START_DATE, 2);
const SLOTS = 4;
const HUMAN_ROSTER = 6;
const RIVAL_ROSTER = 10;
const TITLE_NAME = 'Rival World Title';

type TitleMatch = 'champion' | 'none';

interface ShowSpec {
  readonly date: GameDate;
  readonly importance: 'regular' | 'house';
  /** Later than `date` for a taping. */
  readonly airDate?: GameDate;
  /** What the pre-booked match (champion vs challenger) is: a title match or not. */
  readonly match: TitleMatch;
}

interface WorldOptions {
  readonly shows: readonly ShowSpec[];
  /** Days left on the champion's contract on the first show day; left out, open-ended. */
  readonly championDaysLeft?: number;
  /** Puts the challenger over the title's weight limit. */
  readonly heavyChallenger?: boolean;
}

interface ResultsWorld {
  readonly state: EngineState;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  readonly titleId: TitleId;
  readonly champion: PersonId;
  readonly challenger: PersonId;
  /** The rival shows, in `shows` order. */
  readonly shows: readonly EventInstanceId[];
  /** The pre-booked match on each rival show. */
  readonly matches: readonly SegmentId[];
  readonly humanShow: EventInstanceId;
  readonly humanMatch: SegmentId;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`the results world has no ${what}`);
  }
  return value;
}

/**
 * A: human, 6 wrestlers, one show 40 days out with a match booked and no winner. B: computer, 10
 * wrestlers, a title held by its first wrestler, and the given shows, each with its first two
 * wrestlers (champion vs challenger) already booked in slot 1.
 */
function resultsWorld(options: WorldOptions, overrides: Record<string, number> = {}): ResultsWorld {
  const kept: {
    shows?: EventInstanceId[];
    matches?: SegmentId[];
    humanShow?: EventInstanceId;
    humanMatch?: SegmentId;
  } = {};
  const championEnds =
    options.championDaysLeft === undefined ? null : addDays(SHOW_DAY, options.championDaysLeft);
  const built = worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion({ controller: HUMAN }, (promotion) => promotion.withRoster(HUMAN_ROSTER))
    .withPromotion({ controller: COMPUTER }, (promotion) =>
      promotion
        .withRoster(RIVAL_ROSTER, {
          person: (index) => ({
            weightKg: index === 1 && options.heavyChallenger === true ? 150 : 100,
          }),
          employment: (index) => ({
            alignment: index % 2 === 0 ? 'face' : 'heel',
            endsOn: index === 0 ? championEnds : null,
          }),
        })
        .withTitle(
          {
            name: TITLE_NAME,
            prestige: 60,
            division: { gender: 'open', minWeightKg: null, maxWeightKg: 120 },
          },
          { holder: 0 },
        ),
    )
    .with('shows', (context) => {
      const { promotions, people, regions } = context.ids;
      const regionId = required(regions[0], 'region');
      const titleId = required(context.ids.titles[0], 'title');
      const book = (
        eventInstanceId: EventInstanceId,
        pair: readonly PersonId[],
        titleIds: TitleId[],
      ): SegmentId => {
        const match = context.insert(
          'segments',
          aMatch(
            { eventInstanceId, slot: 1, preShow: false, match: { titleIds } },
            context.sequence,
          ),
        );
        for (const [side, personId] of pair.entries()) {
          context.insert(
            'participants',
            aParticipant({ segmentId: match.id, personId, side }, context.sequence),
          );
        }
        return match.id;
      };
      const champion = required(people[HUMAN_ROSTER], 'champion');
      const challenger = required(people[HUMAN_ROSTER + 1], 'challenger');
      kept.shows = [];
      kept.matches = [];
      for (const [index, spec] of options.shows.entries()) {
        const show = context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId: required(promotions.B, 'B'),
              regionId,
              name: `Rival Show ${String(index + 1)}`,
              importance: spec.importance,
              date: spec.date,
              airDate: spec.airDate ?? spec.date,
              format: { slots: SLOTS, preShowSlots: 0 },
            },
            context.sequence,
          ),
        );
        kept.shows.push(show.id);
        kept.matches.push(
          book(show.id, [champion, challenger], spec.match === 'champion' ? [titleId] : []),
        );
      }
      const humanShow = context.insert(
        'eventInstances',
        anEventInstance(
          {
            promotionId: required(promotions.A, 'A'),
            regionId,
            name: 'Human Weekly',
            date: addDays(SHOW_DAY, 40),
            airDate: addDays(SHOW_DAY, 40),
            format: { slots: SLOTS, preShowSlots: 0 },
          },
          context.sequence,
        ),
      );
      kept.humanShow = humanShow.id;
      kept.humanMatch = book(
        humanShow.id,
        [required(people[0], 'A0'), required(people[1], 'A1')],
        [],
      );
    })
    .build();
  const state = initialEngineState(built.world);
  return {
    state: { ...state, tunableOverrides: overrides },
    human: required(built.ids.promotions.A, 'A'),
    rival: required(built.ids.promotions.B, 'B'),
    titleId: required(built.ids.titles[0], 'title'),
    champion: required(built.ids.people[HUMAN_ROSTER], 'champion'),
    challenger: required(built.ids.people[HUMAN_ROSTER + 1], 'challenger'),
    shows: required(kept.shows, 'shows'),
    matches: required(kept.matches, 'matches'),
    humanShow: required(kept.humanShow, 'human show'),
    humanMatch: required(kept.humanMatch, 'human match'),
  };
}

/** Every reign band's chance at its maximum: a regular show would always move the title. */
const MAXED_CHANCES: Record<string, number> = {
  ...Object.fromEntries(REIGN_BAND_NUMBERS.map((band) => [reignBandChanceKey(band), 100])),
  'aip.titles.bandBeyond.chance': 100,
  'aip.titles.maxChance': 100,
  'aip.titles.valid.gap': 100,
  'aip.titles.valid.floor': 0,
  'aip.titles.strong.gap': 100,
  'aip.titles.strong.floor': 0,
};

/** One show a week from SHOW_DAY. */
function weekly(count: number, importance: ShowSpec['importance'], match: TitleMatch): ShowSpec[] {
  return Array.from({ length: count }, (_, week) => ({
    date: addDays(SHOW_DAY, week * 7),
    importance,
    match,
  }));
}

async function play(world: ResultsWorld, days: number): Promise<Engine> {
  const engine = createEngine({ state: world.state, systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE });
  const result = await engine.advanceDays({ maxDays: days });
  expect(result.failures).toEqual([]);
  expect(result.daysAdvanced).toBe(days);
  return engine;
}

function tablesOf(engine: Engine): Tables {
  return engine.exportState().world.tables;
}

function matchesOn(tables: Tables, showId: EventInstanceId): MatchSegment[] {
  return tables.segments.filter(
    (segment): segment is MatchSegment =>
      segment.eventInstanceId === showId && segment.kind === 'match',
  );
}

function sideOf(tables: Tables, segmentId: SegmentId, personId: PersonId): number {
  return required(
    tables.participants.find(
      (participant) => participant.segmentId === segmentId && participant.personId === personId,
    ),
    'participant',
  ).side;
}

describe('aip.decideResults', () => {
  it('plans every rival match, runs it as booked and leaves the human show alone', async () => {
    const world = resultsWorld({ shows: weekly(1, 'regular', 'none') });
    const engine = await play(world, 3);
    const state = engine.exportState();
    const { tables } = state.world;
    const [showId] = world.shows;
    const show = required(
      tables.eventInstances.find((row) => row.id === showId),
      'rival show',
    );
    expect(show.status).toBe('completed');

    const matches = matchesOn(tables, required(showId, 'show id'));
    expect(matches.length).toBeGreaterThan(1);
    const winnerTraces = new Map(
      state.traces.full
        .filter((entry) => entry.ref.kind === WINNER_TRACE_KIND)
        .map((entry) => [entry.ref.id, entry]),
    );
    for (const match of matches) {
      // EVT3 ran the planned result: the stored plan names the side that won.
      const trace = required(winnerTraces.get(match.id), `winner trace of ${match.id}`);
      expect(match.outcome?.kind).toBe('win');
      if (match.outcome?.kind === 'win') {
        expect(trace.value).toBe(winPlanKey(match.outcome.winningSide));
      }
      expect(JSON.stringify(trace.trace).length).toBeLessThan(8_000);
    }
    // Angles have no winner trace.
    for (const segment of tables.segments) {
      if (segment.eventInstanceId === showId && segment.kind === 'angle') {
        expect(winnerTraces.has(segment.id)).toBe(false);
      }
    }
    // The human show is untouched.
    const humanMatch = required(
      tables.segments.find((segment) => segment.id === world.humanMatch),
      'human match',
    );
    expect(humanMatch.kind === 'match' && humanMatch.outcome).toBeNull();
    expect(winnerTraces.has(world.humanMatch)).toBe(false);

    const winnerDecision = tables.aiDecisions.find(
      (row) => row.kind === WINNER_DECISION_KIND && row.refs.eventInstanceId === showId,
    );
    expect(winnerDecision).toMatchObject({
      summary: {
        key: WINNERS_BOOKED_SUMMARY_KEY,
        params: { show: 'Rival Show 1', matches: matches.length },
      },
      revealOn: show.airDate,
    });
    expect(
      tables.aiDecisions.filter((row) => row.refs.eventInstanceId === world.humanShow),
    ).toEqual([]);
  });

  it('moves the title to the challenger when the champion is leaving, with the reason', async () => {
    const world = resultsWorld({ shows: weekly(1, 'regular', 'champion'), championDaysLeft: 10 });
    const engine = await play(world, 3);
    const { tables } = engine.exportState().world;
    const [segmentId] = world.matches;
    const reign = tables.titleReigns.find(
      (row) => row.titleId === world.titleId && row.lostOn === null,
    );
    expect(reign?.holderIds).toEqual([world.challenger]);
    expect(reign?.wonInSegmentId).toBe(segmentId);

    const decision = tables.aiDecisions.find(
      (row) => row.kind === TITLE_DECISION_KIND && row.refs.titleIds.includes(world.titleId),
    );
    expect(decision).toMatchObject({
      summary: {
        key: TITLE_CHANGE_SUMMARY_KEY,
        params: { reason: 'Contract ending', plan: 'change' },
      },
      traceRef: { kind: TITLE_TRACE_KIND, id: `${String(segmentId)}|${world.titleId}` },
    });

    const changes = engine.query(
      'aip.recentTitleChanges',
      { promotionId: world.rival },
      HUMAN_VIEWER,
    );
    expect(changes.ok).toBe(true);
    if (changes.ok) {
      expectSerialisable(changes.data);
      expect(changes.data.changes).toHaveLength(1);
      expect(changes.data.changes[0]).toMatchObject({
        titleId: world.titleId,
        titleName: TITLE_NAME,
        eventInstanceId: world.shows[0],
        showName: 'Rival Show 1',
        reasonText: 'Contract ending',
        wonOn: SHOW_DAY,
        previousReignDays: 2,
      });
    }
  });

  it('hides a rival result from other players until the show airs', async () => {
    const airDate = addDays(SHOW_DAY, 7);
    const world = resultsWorld({
      shows: [{ date: SHOW_DAY, airDate, importance: 'regular', match: 'none' }],
    });
    const engine = await play(world, 3);
    const segmentId = required(world.matches[0], 'match');

    const hidden = engine.query('aip.segmentDecision', { segmentId }, HUMAN_VIEWER);
    expect(hidden).toEqual({
      ok: false,
      reasons: [
        { code: 'notRevealed', message: "A rival's results are revealed when the show airs" },
      ],
    });
    const seen = engine.query('aip.segmentDecision', { segmentId }, OMNISCIENT_VIEWER);
    expect(seen.ok).toBe(true);

    await engine.advanceDays({ maxDays: 7 });
    const shown = engine.query('aip.segmentDecision', { segmentId }, HUMAN_VIEWER);
    expect(shown.ok).toBe(true);
    if (shown.ok) {
      expectSerialisable(shown.data);
      expect(shown.data.winner.kind).toBe('win');
      expect(shown.data.winner.sideLabel).not.toBeNull();
      expect(shown.data.winner.methodName).not.toBeNull();
      expect(shown.data.reasonText).not.toBe('');
      expect(shown.data.winnerTraceRef).toEqual({ kind: WINNER_TRACE_KIND, id: segmentId });
    }

    const human = engine.query(
      'aip.segmentDecision',
      { segmentId: world.humanMatch },
      HUMAN_VIEWER,
    );
    expect(human).toMatchObject({ ok: false, reasons: [{ code: 'noDecision' }] });
  });
});

// A year of weekly shows on the small world takes about a second per case, so these run with
// `RB_SLOW_TESTS=1` (CI's slow group) rather than in the fast suite.
describe.runIf(SLOW_TESTS)('aip.decideResults over a year', () => {
  it('moves the title within a few weeks of regular shows with every chance maxed', async () => {
    const world = resultsWorld({ shows: weekly(4, 'regular', 'champion') }, MAXED_CHANCES);
    const tables = tablesOf(await play(world, 28));
    expect(
      tables.titleReigns.filter((row) => row.titleId === world.titleId).length,
    ).toBeGreaterThan(1);
  });

  it('keeps the title on house shows for a year, even with every chance maxed', async () => {
    const world = resultsWorld({ shows: weekly(52, 'house', 'champion') }, MAXED_CHANCES);
    const engine = await play(world, 365);
    const tables = tablesOf(engine);
    expect(tables.titleReigns.filter((row) => row.titleId === world.titleId)).toHaveLength(1);
    for (const segmentId of world.matches) {
      const match = required(
        tables.segments.find((segment) => segment.id === segmentId),
        'match',
      );
      expect(match.kind === 'match' && match.outcome).toMatchObject({
        kind: 'win',
        winningSide: sideOf(tables, segmentId, world.champion),
      });
    }
  });

  it('never gives the title to a challenger over the weight limit', async () => {
    const world = resultsWorld(
      { shows: weekly(52, 'regular', 'champion'), heavyChallenger: true, championDaysLeft: 20 },
      MAXED_CHANCES,
    );
    const engine = await play(world, 365);
    const tables = tablesOf(engine);
    for (const reign of tables.titleReigns.filter((row) => row.titleId === world.titleId)) {
      expect(reign.holderIds).not.toContain(world.challenger);
    }
  });

  it('never books a draw with the draw chance at 0, and does with it at 1', async () => {
    const never = await play(resultsWorld({ shows: weekly(52, 'regular', 'none') }), 365);
    const neverTables = tablesOf(never);
    const outcomes = neverTables.segments.flatMap((segment) =>
      segment.kind === 'match' && segment.outcome !== null ? [segment.outcome.kind] : [],
    );
    expect(outcomes.length).toBeGreaterThan(52);
    expect(outcomes).not.toContain('draw');

    const always = await play(
      resultsWorld({ shows: weekly(1, 'regular', 'none') }, { 'aip.winner.drawChance': 1 }),
      3,
    );
    const drawn = tablesOf(always).segments.filter(
      (segment) => segment.kind === 'match' && segment.outcome?.kind === 'draw',
    );
    expect(drawn.length).toBeGreaterThan(0);
  });
});
