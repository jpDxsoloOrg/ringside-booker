// A taped episode airs on its air date (ECO8-07 for EVT9): taped on day 1, aired on day 8, it
// settles exactly one airing on day 8 with the completed show's quality and a TV rights row dated
// day 8, and nothing on day 1. EVT9's taping commands are not on main yet, so the episode is a
// show whose `airDate` is a week after its `date`, as a taping writes it.
// Design: docs/design/broadcast.md#settlement
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays } from '../../../src/core/date';
import { cents } from '../../../src/core/money';
import { broadcastSystem } from '../../../src/systems/broadcast';
import { financeSystem } from '../../../src/systems/finance';
import { matchSystem } from '../../../src/systems/match';
import { showsSystem } from '../../../src/systems/shows';
import { withMyShowsRun } from '../../support';
import { aDeal, aNetwork } from '../../support/builders/media';
import { runsAllButUnrun, showNightWorld, TODAY } from '../shows/show-night-world';

const AIR_DATE = addDays(TODAY, 7);

describe('a taped episode on a TV deal', () => {
  it('settles one airing and its TV rights on the air date, nothing on the taping day', async () => {
    const built = showNightWorld();
    const human = built.human;
    if (human === null) throw new Error('No human show');
    const promotionId = built.world.tables.eventInstances.require(human).promotionId;
    const regionIds = [...built.world.tables.regions.ids()];
    const written = built.world.transact('deal and taping', (tx) => {
      const network = tx.insert(
        'networks',
        aNetwork({
          id: tx.mintId('networks'),
          coverage: { continentIds: [], countryIds: [], regionIds },
        }),
      );
      tx.insert(
        'deals',
        aDeal({
          id: tx.mintId('deals'),
          networkId: network.id,
          promotionId,
          startsOn: addDays(TODAY, -30),
          endsOn: addDays(TODAY, 300),
          terms: {
            feePerShow: cents(100_000),
            perThousandViewers: cents(500),
            costPerShow: cents(10_000),
          },
        }),
      );
      tx.update('eventInstances', human, { importance: 'major', airDate: AIR_DATE });
    });
    if (!written.ok) throw written.error;
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: withMyShowsRun(
        [simSystem, matchSystem, showsSystem, financeSystem, broadcastSystem],
        runsAllButUnrun,
      ),
    });

    const tables = () => engine.exportState().world.tables;
    const airingsOf = () => tables().airings.filter((row) => row.eventInstanceId === human);
    const moneyOf = () =>
      tables().ledgerEntries.filter(
        (row) => row.refs.eventInstanceId === human && row.refs.dealId !== null,
      );

    const taped = await engine.advanceDays({ maxDays: 1 });
    expect(taped.failures).toEqual([]);
    expect(tables().eventInstances.find((row) => row.id === human)?.status).toBe('completed');
    expect(airingsOf()).toEqual([]);
    expect(moneyOf()).toEqual([]);

    const aired = await engine.advanceDays({ maxDays: 7 });
    expect(aired.failures).toEqual([]);
    const score = tables().eventInstances.find((row) => row.id === human)?.result?.score;
    const airings = airingsOf();
    expect(airings).toHaveLength(1);
    expect(airings[0]).toMatchObject({
      airDate: AIR_DATE,
      status: 'aired',
      quality: { score, source: 'show' },
    });
    const rights = moneyOf().filter((row) => row.category === 'broadcast');
    expect(rights).toHaveLength(1);
    expect(rights[0]?.date).toBe(AIR_DATE);
  });
});
