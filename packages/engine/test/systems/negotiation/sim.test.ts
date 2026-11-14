// A headless run with scripted offers (ECO5-05): 20 offers over 90 days give the same signings
// every time from the same seed. Design: docs/design/negotiation.md#review
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { PersonId, PromotionId, RegionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { contractsSystem } from '../../../src/systems/contracts';
import { financeSystem } from '../../../src/systems/finance';
import { askTermsOf, negotiationSystem, type Offer } from '../../../src/systems/negotiation';
import { workersSystem } from '../../../src/systems/workers';
import { anOffer, aPerson, resetTestIds, worldBuilder } from '../../support';
import { PLAYER, PLAYER_VIEW } from './negotiation-world';

const SYSTEMS = [simSystem, financeSystem, workersSystem, contractsSystem, negotiationSystem];
const DAYS = 90;
const OFFERS = 20;
const FREE_AGENTS = 12;
/** The share of the ask each scripted offer pays, in turn: accepts, counters, rejections, walks. */
const SHARES = [1.05, 0.97, 0.7, 0.6, 0.5, 0.4] as const;

interface Script {
  readonly engine: Engine;
  readonly promotions: readonly PromotionId[];
  readonly freeAgents: readonly PersonId[];
}

function scriptedWorld(seed: string): Script {
  resetTestIds();
  const freeAgents: PersonId[] = [];
  const { world, ids } = worldBuilder({ seed })
    .withGeography('mini')
    .withPromotion({ name: 'Scripted A', controller: PLAYER }, (promotion) =>
      promotion.withRoster(6),
    )
    .withPromotion({ name: 'Scripted B', controller: PLAYER }, (promotion) =>
      promotion.withRoster(6),
    )
    .with('known everywhere, and free agents', (context) => {
      const everywhere: Record<RegionId, number> = {};
      for (const regionId of context.ids.regions) {
        everywhere[regionId] = 70;
      }
      for (const promotionId of Object.values(context.ids.promotions)) {
        context.tx.update('promotions', promotionId, { regionalPop: everywhere });
      }
      for (let index = 0; index < FREE_AGENTS; index += 1) {
        const pop: Record<RegionId, number> = {};
        for (const regionId of context.ids.regions) {
          pop[regionId] = 20 + index * 5;
        }
        freeAgents.push(
          context.insert('people', aPerson({ regionalPop: pop }, context.sequence)).id,
        );
      }
    })
    .build();
  const engine = createEngine({ state: initialEngineState(world), systems: SYSTEMS });
  for (const [key, value] of Object.entries({
    'contracts.expiringSoon.stopSkip': false,
    'contracts.releaseRequest.stopSkip': false,
    // Scripted B lets counter-offers lapse, which needs the counter stop off (ECO5-06 turned it on).
    'contracts.counter.stopSkip': false,
  })) {
    const set = engine.command('tunables.setOverride', { key, value }, PLAYER);
    if (!set.ok) {
      throw new Error(`could not set ${key}`);
    }
  }
  const promotions = [ids.promotions.A, ids.promotions.B].filter(
    (id): id is PromotionId => id !== undefined,
  );
  return { engine, promotions, freeAgents };
}

function offerFor(engine: Engine, promotionId: PromotionId, personId: PersonId, share: number) {
  const asked = engine.query(
    'contracts.askingTerms',
    { promotionId, personId, kind: 'written', exclusive: false },
    PLAYER_VIEW,
  );
  if (!asked.ok) {
    return null;
  }
  const ask = asked.data;
  const terms = askTermsOf(ask);
  const offer: Offer = anOffer({
    lengthMonths: ask.preferredLengthMonths.value,
    push: ask.expectedPush.value === 'none' ? 'midCard' : ask.expectedPush.value,
    terms: {
      ...terms,
      monthlyWage: cents(Math.round((terms.monthlyWage * share) / 100) * 100),
      signingBonus: cents(0),
    },
  });
  return offer;
}

/** Runs the script and returns every signing as `person@promotion`, sorted. */
async function run(
  seed: string,
): Promise<{ signed: string[]; statuses: string[]; issues: number }> {
  const { engine, promotions, freeAgents } = scriptedWorld(seed);
  let made = 0;
  for (let day = 0; day < DAYS; day += 1) {
    if (day % 4 === 0 && made < OFFERS) {
      const promotionId = promotions[made % 2];
      const personId = freeAgents[made % FREE_AGENTS];
      const share = SHARES[made % SHARES.length] ?? 1;
      made += 1;
      const offer =
        promotionId === undefined || personId === undefined
          ? null
          : offerFor(engine, promotionId, personId, share);
      if (offer !== null && promotionId !== undefined && personId !== undefined) {
        // A refusal (already talking, cooling off, already signed) is part of the script.
        engine.command('contracts.makeOffer', { promotionId, personId, offer }, PLAYER);
      }
    }
    // Scripted A answers every counter-offer by accepting it; Scripted B lets them lapse.
    for (const row of engine.exportState().world.tables.negotiations) {
      if (row.status === 'countered' && row.promotionId === promotions[0]) {
        engine.command(
          'contracts.respondToCounter',
          { negotiationId: row.id, response: 'accept' },
          PLAYER,
        );
      }
    }
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.daysAdvanced).toBe(1);
  }
  const { world } = engine.exportState();
  const signed = world.tables.negotiations
    .filter((row) => row.status === 'signed')
    .map((row) => `${row.personId}@${row.promotionId}`)
    .sort();
  const statuses = [...new Set(world.tables.negotiations.map((row) => row.status))].sort();
  const built = documentToWorld({ state: { world } }, TABLES);
  return {
    signed,
    statuses,
    issues: checkWorld(built, TABLES, { validateRows: true }).issues.length,
  };
}

describe('scripted offers over 90 days', () => {
  it('sign the same workers on two runs from the same seed, with a clean world', async () => {
    const first = await run('negotiation-sim');
    const second = await run('negotiation-sim');
    expect(second.signed).toEqual(first.signed);
    expect(first.signed.length).toBeGreaterThan(0);
    expect(first.statuses).toEqual(expect.arrayContaining(['signed', 'walkedAway', 'lapsed']));
    expect(first.issues).toBe(0);
  });
});
