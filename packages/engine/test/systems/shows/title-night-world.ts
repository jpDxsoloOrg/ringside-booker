/**
 * The world the title outcome and appearance tests share. Today is Tuesday 2026-01-06.
 *
 * - promotion A is run by `player-1` and has a roster of 8;
 *   - `world`: a singles title held by roster 0;
 *   - `second`: another singles title held by roster 0;
 *   - `tag`: a tag title held by roster 2 and 3 (team `holders`);
 *   - `vacant`: a singles title nobody holds;
 *   - team `challengers` is roster 4 and 5;
 * - promotion B is run by the computer and has a roster of 2 and a title of its own, `rival`;
 * - `show`: A's show today, already locked, with 5 main-card slots and 1 pre-show slot and no card.
 *
 * Tests write the card with `seed` and run `shows.runShows` once with `runNight`.
 */

import { parseContentKey } from '../../../src/core/content-key';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { AnyDomainEvent, DomainEventMap } from '../../../src/core/events/types';
import type { EventInstanceId, PersonId, TeamId, TitleId } from '../../../src/core/ids';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { MatchOutcome } from '../../../src/model/entities/segment';
import type { GameTables, GameWorld } from '../../../src/model/tables';
import {
  MatchDraftSchema,
  type MatchDraft,
  type ParticipantDraft,
} from '../../../src/systems/booking';
import { runShowsPhase } from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { aTeam, anEventInstance, worldBuilder } from '../../support';
import type { StepReport } from '../../../src/core/pipeline/report';
import { PLAYER_ONE } from '../calendar/lifecycle-world';

export const START = '2026-01-05';
export const TODAY = parseGameDate('2026-01-06');
export const PINFALL = parseContentKey('method.pinfall');
export const COUNT_OUT = parseContentKey('method.count-out');

export interface TitleNightWorld {
  readonly world: GameWorld;
  readonly show: EventInstanceId;
  /** B's show today, with no card (scored off-screen). */
  readonly rivalShow: EventInstanceId;
  readonly roster: readonly PersonId[];
  readonly rivals: readonly PersonId[];
  readonly titles: {
    readonly world: TitleId;
    readonly second: TitleId;
    readonly tag: TitleId;
    readonly vacant: TitleId;
    readonly rival: TitleId;
  };
  readonly teams: { readonly holders: TeamId; readonly challengers: TeamId };
}

function at<T>(values: readonly T[], index: number, what: string): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`The title night world has no ${what} ${String(index)}`);
  }
  return value;
}

export interface TitleNightOptions {
  /** The day the world is on (and the show's date). Defaults to `TODAY`. */
  readonly today?: GameDate;
  /** `appearancesThisYear` every roster contract starts with. Defaults to 0. */
  readonly appearances?: number;
}

/** Builds the title night world. */
export function titleNightWorld(options: TitleNightOptions = {}): TitleNightWorld {
  const today = options.today ?? TODAY;
  let shows: { show: EventInstanceId; rivalShow: EventInstanceId } | undefined;
  let teams: { holders: TeamId; challengers: TeamId } | undefined;
  const { world, ids } = worldBuilder({
    startDate: START,
    currentDate: today,
    players: [{ playerId: 'player-1', displayName: 'Test Player 1' }],
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion
        .withRoster(8, {
          employment: () => ({ appearancesThisYear: options.appearances ?? 0 }),
        })
        .withTitle({ name: 'Test World Title' }, { holder: 0 })
        .withTitle({ name: 'Test Second Title' }, { holder: 0 })
        .withTitle({ name: 'Test Tag Title', holderCount: 2 }, { holder: [2, 3] })
        .withTitle({ name: 'Test Vacant Title' }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) =>
      promotion.withRoster(2).withTitle({ name: 'Test Rival Title' }, { holder: 0 }),
    )
    .with('shows', (context) => {
      const promotionA = context.ids.promotions.A;
      const promotionB = context.ids.promotions.B;
      const regionId = context.ids.regions[0];
      if (promotionA === undefined || promotionB === undefined || regionId === undefined) {
        throw new Error('The title night world is missing a promotion or a region');
      }
      const person = (index: number): PersonId => at(context.ids.people, index, 'person');
      teams = {
        holders: context.insert(
          'teams',
          aTeam({ name: 'Test Holders', memberIds: [person(2), person(3)] }, context.sequence),
        ).id,
        challengers: context.insert(
          'teams',
          aTeam({ name: 'Test Challengers', memberIds: [person(4), person(5)] }, context.sequence),
        ).id,
      };
      shows = {
        show: context.insert(
          'eventInstances',
          anEventInstance(
            {
              name: 'Test Title Show',
              promotionId: promotionA,
              regionId,
              date: today,
              status: 'booked',
              format: { slots: 5, preShowSlots: 1 },
            },
            context.sequence,
          ),
        ).id,
        rivalShow: context.insert(
          'eventInstances',
          anEventInstance(
            { name: 'Test Rival Show', promotionId: promotionB, regionId, date: today },
            context.sequence,
          ),
        ).id,
      };
    })
    .build();
  if (shows === undefined || teams === undefined) {
    throw new Error('The title night world was built without its shows');
  }
  const title = (index: number): TitleId => at(ids.titles, index, 'title');
  return {
    world,
    ...shows,
    roster: ids.people.slice(0, 8),
    rivals: ids.people.slice(8, 10),
    titles: {
      world: title(0),
      second: title(1),
      tag: title(2),
      vacant: title(3),
      rival: title(4),
    },
    teams,
  };
}

/** Roster member `index` of promotion A. */
export function member(built: TitleNightWorld, index: number): PersonId {
  return at(built.roster, index, 'roster member');
}

/** A competitor on `side`, optionally for a team. */
export function competitor(
  personId: PersonId,
  side: number,
  teamId: TeamId | null = null,
): ParticipantDraft {
  return { personId, side, role: 'competitor', teamId };
}

/** A match of `matchType` between the given competitors, for the given titles. */
export function titleMatch(
  participants: readonly ParticipantDraft[],
  outcome: MatchOutcome | null,
  titleIds: readonly TitleId[],
  matchType = 'match.singles',
): MatchDraft {
  return MatchDraftSchema.parse({
    kind: 'match',
    label: null,
    match: { matchTypeKey: parseContentKey(matchType), titleIds: [...titleIds] },
    participants: [...participants],
    outcome,
  });
}

/** A win for `side` by `methodKey` (pinfall by default). */
export function winFor(side: number, methodKey = PINFALL): MatchOutcome {
  return { kind: 'win', winningSide: side, methodKey };
}

export interface NightRun {
  readonly runtime: SimRuntime<GameTables>;
  readonly report: StepReport;
}

/** Runs `shows.runShows` once on the world's current date, with the given tunable overrides. */
export function runNight(built: TitleNightWorld, overrides: TunableOverrides = {}): NightRun {
  const runtime = createRuntime({
    world: built.world,
    tunables: createEngineTunables(overrides),
  });
  const report = runStep(
    runtime,
    runShowsPhase.id,
    { kind: 'phase', id: runShowsPhase.id },
    runShowsPhase.run,
    { date: built.world.meta.currentDate },
  );
  if (report.status !== 'ok') {
    throw new Error(`shows.runShows did not run: ${JSON.stringify(report)}`);
  }
  return { runtime, report };
}

/** The title events the night published, oldest first. */
export function titleEvents(runtime: SimRuntime<GameTables>): AnyDomainEvent[] {
  return runtime.bus.recent({ limit: 1000, types: ['title.changed', 'title.defended'] });
}

/** The `title.changed` payloads, oldest first. */
export function changedEvents(runtime: SimRuntime<GameTables>): DomainEventMap['title.changed'][] {
  return titleEvents(runtime).flatMap((event) =>
    event.type === 'title.changed' ? [event.payload] : [],
  );
}

/** The `title.defended` payloads, oldest first. */
export function defendedEvents(
  runtime: SimRuntime<GameTables>,
): DomainEventMap['title.defended'][] {
  return titleEvents(runtime).flatMap((event) =>
    event.type === 'title.defended' ? [event.payload] : [],
  );
}
