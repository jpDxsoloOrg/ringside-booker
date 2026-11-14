// The orphaned-champion rule on the shipped default world, before any feature ends contracts
// (CRTV1-07). Nothing in the game ends an employment yet (ECO4's release and expiry need the
// player to act; DAY6's retirements are not built), so the owner can't see a title vacated because
// its champion left. This test plays that day for them: Altura's World Champion's contract ended
// yesterday, and `titles.orphanGraceDays` days later the title is vacant with a `titles.vacancy`
// Why? that names the champion, the date they left and the grace tunable.
//
// What the owner will see once ECO4 or DAY6 ends a champion's contract: the title keeps its
// champion for the grace days, then shows "Vacant since <that day>"; the lineage's last reign
// ends "Vacated" and its Why? reads "<name> has had no contract with <promotion> since <date>
// (<n> days)" next to the "Days a champion may be gone" setting.
// A new default-world game and a week of it take well under a second, so this runs in `npm test`.
// Design: docs/design/titles.md#orphaned-champions
import { describe, expect, it } from 'vitest';
import { createEngine, type EngineState } from '../../../src/core/api';
import { addDays } from '../../../src/core/date';
import { isFullTrace } from '../../../src/core/trace/store';
import { defaultSystems } from '../../../src/systems';
import {
  ORPHANED_VACANCY_REASON_KEY,
  reignDateText,
  titleVacancyTraceRef,
  titlesTunables,
} from '../../../src/systems/titles';
import { withMyShowsRun } from '../../support';
import { anEmployment } from '../../support/builders/promotions';
import { startDefaultGame } from '../calendar/default-game';
import { storedTrace } from './title-commands-world';

const TITLE_NAME = 'Altura World Championship';
const GRACE_DAYS = titlesTunables['titles.orphanGraceDays'].default;

/** The default world with the World Champion's Altura contract ended (released) yesterday. */
function worldWithGoneChampion() {
  const state = startDefaultGame();
  const { titles, titleReigns, employments } = state.world.tables;
  const title = titles.find((row) => row.name === TITLE_NAME);
  const reign = titleReigns.find((row) => row.titleId === title?.id && row.lostOn === null);
  if (title === undefined || reign === undefined) {
    throw new Error(`${TITLE_NAME} has no champion in the default world`);
  }
  const [championId] = reign.holderIds;
  const today = state.world.meta.currentDate;
  const leftOn = addDays(today, -1);
  const contract = employments.find(
    (row) =>
      row.personId === championId &&
      row.promotionId === title.promotionId &&
      row.status === 'active',
  );
  if (championId === undefined || contract === undefined) {
    throw new Error(`${TITLE_NAME}'s champion has no Altura contract`);
  }
  // The builder checks the edited row against the employment schema.
  const ended = anEmployment({ ...contract, status: 'released', endedOn: leftOn });
  const endedState: EngineState = {
    ...state,
    world: {
      ...state.world,
      tables: {
        ...state.world.tables,
        employments: employments.map((row) => (row.id === contract.id ? ended : row)),
      },
    },
  };
  return { state: endedState, title, reign, championId, leftOn };
}

describe('a default-world champion whose contract ends', () => {
  it(
    `loses the title after titles.orphanGraceDays (${String(GRACE_DAYS)}) days, with a Why?`,
    { timeout: 30_000 },
    async () => {
      const { state, title, reign, championId, leftOn } = worldWithGoneChampion();
      const engine = createEngine({ state, systems: withMyShowsRun(defaultSystems) });
      const openReign = () =>
        engine
          .exportState()
          .world.tables.titleReigns.find((row) => row.titleId === title.id && row.lostOn === null);

      // Each advance runs the day being left: the first runs the day after they left.
      for (let day = 1; day < GRACE_DAYS; day += 1) {
        const result = await engine.advanceDays({ maxDays: 1 });
        expect(result.failures).toEqual([]);
        expect(result.daysAdvanced).toBe(1);
        expect(openReign()?.id, `still champion ${String(day)} day(s) after leaving`).toBe(
          reign.id,
        );
      }
      const last = await engine.advanceDays({ maxDays: 1 });
      expect(last.failures).toEqual([]);
      expect(last.daysAdvanced).toBe(1);
      expect(openReign()).toBeUndefined();

      const ended = engine
        .exportState()
        .world.tables.titleReigns.find((row) => row.id === reign.id);
      expect(ended).toMatchObject({
        endReason: 'vacated',
        lostOn: addDays(leftOn, GRACE_DAYS),
      });
      const events = engine.query(
        'sim.recentEvents',
        { limit: 500, types: ['title.vacated'] },
        { kind: 'omniscient' },
      );
      expect(events.ok && events.data.map((event) => event.payload)).toEqual([
        expect.objectContaining({
          titleId: title.id,
          reignId: reign.id,
          holderIds: [championId],
          reasonKey: ORPHANED_VACANCY_REASON_KEY,
          source: 'system',
        }),
      ]);

      // The lineage row's Why? is the stored vacancy trace: the champion, the day they left and
      // the grace setting.
      const trace = storedTrace(engine, titleVacancyTraceRef(reign.id));
      if (trace === null || !isFullTrace(trace)) {
        expect.fail('no titles.vacancy trace');
      }
      expect(trace.trace).toMatchObject({
        kind: 'decision',
        label: 'How the reign ended',
        chosen: 'vacated',
      });
      const text = JSON.stringify(trace.trace);
      expect(text).not.toMatch(/undefined|NaN/);
      const ruleLine = trace.trace.children?.find((node) => node.kind === 'branch');
      expect(ruleLine?.label).toMatch(
        new RegExp(
          `^${reign.holderNamesAtTime[0] ?? ''} has had no contract with .*Altura.* since ${reignDateText(leftOn)} \\(${String(GRACE_DAYS)} days\\)$`,
        ),
      );
      expect(trace.trace.children?.find((node) => node.kind === 'input')).toMatchObject({
        value: `No contract for ${String(GRACE_DAYS)} days`,
        ref: { kind: 'person', id: championId },
      });
      expect(trace.trace.children?.find((node) => node.kind === 'tunable')).toMatchObject({
        key: 'titles.orphanGraceDays',
        value: GRACE_DAYS,
      });

      const detail = engine.query(
        'titles.detail',
        { titleId: title.id },
        { kind: 'controller', controller: { kind: 'human', playerId: 'local-player' } },
      );
      if (!detail.ok) {
        expect.fail(JSON.stringify(detail.reasons));
      }
      expect(detail.data.title.champion).toBeNull();
      expect(detail.data.reigns[0]).toMatchObject({
        reignId: reign.id,
        endReasonLabel: 'Vacated',
        endTraceRef: titleVacancyTraceRef(reign.id),
      });
    },
  );
});
