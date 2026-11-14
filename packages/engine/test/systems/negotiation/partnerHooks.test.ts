// The hooks partner features call to join negotiation, run through the real offer path
// (`contracts.makeOffer` → `submitOffer` → `contracts.reviewOffers`), so a partner that lands
// later (ECO11, SOC4, ECO6, ...) only has to register. ECO5-07.
// Design: docs/design/negotiation.md#integrations
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Controller } from '../../../src/core/api/controller';
import type { EmploymentId, NegotiationId, PersonId, PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { inputOf } from '../../../src/core/trace/helpers';
import type { Negotiation } from '../../../src/model/entities/negotiation';
import { contractsSystem } from '../../../src/systems/contracts';
import { financeSystem } from '../../../src/systems/finance';
import {
  askTermsOf,
  askTraceRef,
  BAD_KIND_EXTRA_CODE,
  negotiationSystem,
  registerAskModifier,
  registerCounterResponder,
  registerOfferKind,
  registerPatienceModifier,
  type AskingTermsView,
  type Offer,
  type OfferExtra,
} from '../../../src/systems/negotiation';
import { workersSystem } from '../../../src/systems/workers';
import { anOffer } from '../../support';
import { negotiationWorld, PLAYER, PLAYER_VIEW, type NegotiationWorld } from './negotiation-world';

const COMPUTER: Controller = { kind: 'computer' };
const SYSTEMS = [simSystem, financeSystem, workersSystem, contractsSystem, negotiationSystem];
/** Stops that would end a skip early for reasons this file does not test. */
const QUIET = {
  'contracts.expiringSoon.stopSkip': false,
  'contracts.releaseRequest.stopSkip': false,
  'contracts.counter.stopSkip': false,
} as const;

function engineFor(setup: NegotiationWorld): Engine {
  const engine = createEngine({ state: initialEngineState(setup.world), systems: SYSTEMS });
  for (const [key, value] of Object.entries(QUIET)) {
    done(engine.command('tunables.setOverride', { key, value }, PLAYER));
  }
  return engine;
}

function done<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function negotiationOf(engine: Engine, id: NegotiationId): Negotiation {
  const row = engine.exportState().world.tables.negotiations.find((entry) => entry.id === id);
  if (row === undefined) {
    throw new Error(`missing negotiation ${id}`);
  }
  return row;
}

function askOf(
  engine: Engine,
  promotionId: PromotionId,
  personId: PersonId,
  kind: 'written' | 'development' = 'written',
): AskingTermsView {
  return done(
    engine.query(
      'contracts.askingTerms',
      { promotionId, personId, kind, exclusive: kind === 'written' },
      PLAYER_VIEW,
    ),
  );
}

/** Their ask as an offer, with the wage and bonus scaled by `share`. */
function offerAt(ask: AskingTermsView, share: number, extra: OfferExtra = {}): Offer {
  const terms = askTermsOf(ask);
  return anOffer({
    lengthMonths: ask.preferredLengthMonths.value,
    push: ask.expectedPush.value === 'none' ? 'midCard' : ask.expectedPush.value,
    extra,
    terms: {
      ...terms,
      monthlyWage: cents(Math.round((terms.monthlyWage * share) / 100) * 100),
      signingBonus: cents(Math.round((terms.signingBonus * share) / 100) * 100),
    },
  });
}

/** Registers hooks for one test and removes them afterwards, even when the test fails. */
async function withHooks(unregister: (() => void)[], run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } finally {
    for (const remove of unregister) {
      remove();
    }
  }
}

describe('offer kinds (ECO11 development deals, ECO12 tours)', () => {
  it('asks less for a registered kind, checks its extra terms and runs its signing hook', async () => {
    const setup = negotiationWorld();
    const engine = engineFor(setup);
    const signed: { employmentId: EmploymentId; extra: OfferExtra }[] = [];
    const removeKind = registerOfferKind({
      key: 'development',
      label: 'Development',
      order: 30,
      available: () => [],
      askMultiplier: () => inputOf('Development deal', 0.6),
      extraSchema: z.object({ territoryId: z.string().min(1, 'Pick a territory') }).strict(),
      onSigned: (_ctx, employmentId, extra) => {
        signed.push({ employmentId, extra });
      },
    });
    await withHooks([removeKind], async () => {
      const written = askOf(engine, setup.human, setup.veteran, 'written');
      const development = askOf(engine, setup.human, setup.veteran, 'development');
      expect(development.allowedKinds.map((entry) => entry.kind)).toContain('development');
      expect(development.monthlyWage.value).toBeLessThan(written.monthlyWage.value);
      expect(JSON.stringify(development.monthlyWage.trace)).toContain('Development deal');

      const missing = engine.command(
        'contracts.makeOffer',
        { promotionId: setup.human, personId: setup.veteran, offer: offerAt(development, 1) },
        PLAYER,
      );
      expect(missing.ok ? [] : missing.reasons.map((reason) => reason.code)).toEqual([
        BAD_KIND_EXTRA_CODE,
      ]);

      const id = done(
        engine.command(
          'contracts.makeOffer',
          {
            promotionId: setup.human,
            personId: setup.veteran,
            offer: offerAt(development, 1, { territoryId: 'ter_north' }),
          },
          PLAYER,
        ),
      ).negotiationId;
      expect(signed).toEqual([]);
      await engine.advanceDays({ maxDays: 3 });
      const row = negotiationOf(engine, id);
      expect(row.status).toBe('signed');
      expect(signed).toEqual([
        { employmentId: row.employmentId, extra: { territoryId: 'ter_north' } },
      ]);
    });
  });
});

describe('ask and patience modifiers (SOC4 rapport)', () => {
  /** Counter-offers a worker makes to repeated 60% offers before walking away. */
  async function countersBeforeWalkingAway(): Promise<{ counters: number; askWhy: string }> {
    const setup = negotiationWorld();
    const engine = engineFor(setup);
    const ask = askOf(engine, setup.human, setup.veteran);
    const offer = offerAt(ask, 0.6);
    const id = done(
      engine.command(
        'contracts.makeOffer',
        { promotionId: setup.human, personId: setup.veteran, offer },
        PLAYER,
      ),
    ).negotiationId;
    await engine.advanceDays({ maxDays: 1 });
    // The round's ask Why? (wage asked and patience at the start) is where modifiers show; the
    // reaction's Why? weighs the offer against that ask's value.
    const askWhy = done(engine.query('trace.get', { ref: askTraceRef(id, 1) }, PLAYER_VIEW));
    let counters = 0;
    for (
      let round = 0;
      round < 20 && negotiationOf(engine, id).status === 'countered';
      round += 1
    ) {
      counters += 1;
      done(
        engine.command(
          'contracts.respondToCounter',
          { negotiationId: id, response: 'revise', offer },
          PLAYER,
        ),
      );
      await engine.advanceDays({ maxDays: 1 });
    }
    expect(negotiationOf(engine, id).status).toBe('walkedAway');
    return { counters, askWhy: JSON.stringify(askWhy) };
  }

  it('puts the rapport line in the ask Why? and gives a high-rapport worker one more counter', async () => {
    const plain = await countersBeforeWalkingAway();
    const removeAsk = registerAskModifier({
      id: 'social.rapport',
      order: 10,
      label: 'Rapport with you',
      compute: () => inputOf('Rapport with you', 0.98),
    });
    const removePatience = registerPatienceModifier({
      id: 'social.rapport',
      order: 10,
      label: 'Rapport with you',
      compute: () => inputOf('Rapport with you', 1),
    });
    await withHooks([removeAsk, removePatience], async () => {
      const friendly = await countersBeforeWalkingAway();
      expect(plain.askWhy).not.toContain('Rapport with you');
      expect(friendly.askWhy).toContain('Rapport with you');
      expect(plain.counters).toBeGreaterThan(0);
      expect(friendly.counters).toBe(plain.counters + 1);
    });
  });
});

describe('counter responders (ECO6 rival hiring)', () => {
  it('replaces the built-in answer for computer promotions and is never asked about the player', async () => {
    const setup = negotiationWorld();
    const engine = engineFor(setup);
    const asked: PromotionId[] = [];
    const removeResponder = registerCounterResponder({
      id: 'rivalHiring.counter',
      respond: (_ctx, negotiation) => {
        asked.push(negotiation.promotionId);
        return { response: 'end', trace: inputOf('Never pays more than its first offer', 'end') };
      },
    });
    await withHooks([removeResponder], async () => {
      const ask = askOf(engine, setup.human, setup.veteran);
      const rivalTalks = done(
        engine.command(
          'contracts.makeOffer',
          { promotionId: setup.rival, personId: setup.veteran, offer: offerAt(ask, 0.6) },
          COMPUTER,
        ),
      ).negotiationId;
      const leaving = setup.person(setup.rivalEnding);
      const myTalks = done(
        engine.command(
          'contracts.makeOffer',
          {
            promotionId: setup.human,
            personId: leaving,
            offer: offerAt(askOf(engine, setup.human, leaving), 0.6),
          },
          PLAYER,
        ),
      ).negotiationId;
      await engine.advanceDays({ maxDays: 3 });
      // The built-in rule would accept a counter at or below the ask; this responder ends talks.
      expect(negotiationOf(engine, rivalTalks)).toMatchObject({
        status: 'withdrawn',
        outcome: { code: 'talksEnded', otherPromotionId: null },
      });
      expect(asked).toEqual([setup.rival]);
      expect(negotiationOf(engine, myTalks).status).not.toBe('withdrawn');
    });
  });
});
