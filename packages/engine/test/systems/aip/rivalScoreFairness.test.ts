// Rival rules fairness on the default world (AIP1-07): how much the `ai.scoreBonus` shortcut lifts
// rival show scores once the rival desk's rating policy is wired, and that the Level playing field
// setting takes it away again.
//
// A balance harness: it runs only in the slow run (`RB_SLOW_TESTS=1`, `npm run verify:full`; see
// support/slow.ts), over 13 weeks. The full year the ticket reports is opt-in:
//   RB_SLOW_TESTS=1 RB_BALANCE_DAYS=365 npx vitest run --project engine test/systems/aip/rivalScoreFairness
// Every show gets a card (`cardEveryShowSystem`): a rival show with no card is scored off screen
// (show-night.md#off-screen-score), which never goes through a segment rating, so the bonus only
// reaches rival shows that have a card. Measured 2026-11 over 365 days: see
// docs/design/rival-desk.md#shortcuts.
// Design: docs/design/rival-desk.md#shortcuts
import { describe, expect, it } from 'vitest';
import { createEngine, type EngineState } from '../../../src/core/api';
import { defaultSystems } from '../../../src/systems';
import { withMyShowsRun } from '../../support';
import { cardEveryShowSystem } from '../../support/card-every-show';
import { SLOW_TESTS } from '../../support/slow';
import { startDefaultGame } from '../calendar/default-game';

const DAYS = Number(process.env['RB_BALANCE_DAYS'] ?? '91');
/** Generous: a busy machine runs the default world several times slower. */
const TIMEOUT_MS = 120_000 + DAYS * 2_000;

interface ScoreLevels {
  readonly rivalShows: number;
  readonly rivalShowMean: number;
  readonly rivalSegmentMean: number;
  readonly playerShowMean: number;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Mean completed-show and segment scores, split by who runs the show's promotion. */
function scoreLevels(state: EngineState): ScoreLevels {
  const { promotions, eventInstances, segments } = state.world.tables;
  const computerRun = new Set(
    promotions.filter((row) => row.controller.kind === 'computer').map((row) => row.id),
  );
  const completed = eventInstances.filter((show) => show.result !== null);
  const rivalShowIds = new Set(
    completed.filter((show) => computerRun.has(show.promotionId)).map((show) => show.id),
  );
  const rivalShowScores = completed
    .filter((show) => rivalShowIds.has(show.id))
    .map((show) => show.result?.score ?? 0);
  const playerShowScores = completed
    .filter((show) => !rivalShowIds.has(show.id))
    .map((show) => show.result?.score ?? 0);
  const rivalSegmentScores = segments
    .filter((segment) => rivalShowIds.has(segment.eventInstanceId) && segment.rating !== null)
    .map((segment) => segment.rating?.score ?? 0);
  return {
    rivalShows: rivalShowScores.length,
    rivalShowMean: mean(rivalShowScores),
    rivalSegmentMean: mean(rivalSegmentScores),
    playerShowMean: mean(playerShowScores),
  };
}

async function runYear(levelPlayingField: boolean): Promise<ScoreLevels> {
  const state = startDefaultGame();
  state.world.meta.settings.levelPlayingField = levelPlayingField;
  const engine = createEngine({
    state,
    systems: withMyShowsRun([...defaultSystems, cardEveryShowSystem]),
  });
  const advanced = await engine.advanceDays({ maxDays: DAYS });
  expect(advanced.failures).toEqual([]);
  return scoreLevels(engine.exportState());
}

function levelsText(label: string, levels: ScoreLevels): string {
  return `${label}: ${String(levels.rivalShows)} rival shows, rival show mean ${levels.rivalShowMean.toFixed(2)}, rival segment mean ${levels.rivalSegmentMean.toFixed(2)}, player show mean ${levels.playerShowMean.toFixed(2)}`;
}

describe.runIf(SLOW_TESTS)('rival score bonus on the default world with every show carded', () => {
  it(
    `lifts rival segment scores by about the bonus, and the level playing field removes it (${String(DAYS)} days)`,
    { timeout: TIMEOUT_MS * 2 },
    async () => {
      const rivalRules = await runYear(false);
      const levelField = await runYear(true);
      console.log(levelsText('Rival rules (defaults)', rivalRules));
      console.log(levelsText('Level playing field', levelField));

      expect(rivalRules.rivalShows).toBeGreaterThan(50);
      // The bonus is 3 points a segment; worker states drift apart between the runs, so allow slack.
      const lift = rivalRules.rivalSegmentMean - levelField.rivalSegmentMean;
      expect(lift).toBeGreaterThan(1.5);
      expect(lift).toBeLessThan(5);
      expect(rivalRules.rivalShowMean).toBeGreaterThan(levelField.rivalShowMean);
    },
  );
});
