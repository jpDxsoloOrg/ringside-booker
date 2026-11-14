// How a worker reacts to offers in a world, and `contracts.offerPreview` (ECO5-03).
// Design: docs/design/negotiation.md#contract-value, #reaction and #counter
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import { INVALID_ARGS } from '../../../src/core/api/result';
import type { PersonId, PromotionId, RegionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { GameWorld } from '../../../src/model/tables';
import { reachOf } from '../../../src/systems/finance/reach';
import {
  askingTermsFor,
  askTermsOf,
  COOLING_OFF_CODE,
  evaluateOffer,
  LIKELY_NOTE,
  MATCHES_COUNTER_REASON,
  notEnforcedLine,
  PART_OF_THE_WAY_NOTE,
  REFUSES_RENEWAL_MESSAGE,
  roleMismatch,
  UNKNOWN_NEGOTIATION_MESSAGE,
  type AskingTerms,
  type Offer,
  type OfferPreview,
} from '../../../src/systems/negotiation';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  aNegotiation,
  aPerson,
  resetTestIds,
  worldBuilder,
  type BuildContext,
} from '../../support';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import {
  ask,
  negotiationEngine,
  negotiationWorld,
  OMNISCIENT,
  OTHER_VIEW,
  PLAYER,
  PLAYER_VIEW,
  setMorale,
} from './negotiation-world';

interface ReachWorld {
  readonly world: GameWorld;
  readonly big: PromotionId;
  readonly small: PromotionId;
  readonly free: PersonId;
}

function everywhere(context: BuildContext, value: number): Record<RegionId, number> {
  const pop: Record<RegionId, number> = {};
  for (const regionId of context.ids.regions) {
    pop[regionId] = value;
  }
  return pop;
}

/** Two of the player's promotions, one far better known than the other, and one free agent. */
function reachWorld(): ReachWorld {
  resetTestIds();
  let free: PersonId | undefined;
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'Big Wrestling', controller: PLAYER, prestige: 60 })
    .withPromotion({ name: 'Small Wrestling', controller: PLAYER, prestige: 60 })
    .with('known promotions and a free agent', (context) => {
      const [big, small] = [context.ids.promotions.A, context.ids.promotions.B];
      if (big === undefined || small === undefined) {
        throw new Error('reach world: missing promotions');
      }
      context.tx.update('promotions', big, { regionalPop: everywhere(context, 90) });
      context.tx.update('promotions', small, { regionalPop: everywhere(context, 50) });
      free = context.insert(
        'people',
        aPerson(
          { regionalPop: everywhere(context, 60), traits: [], roles: ['wrestler'] },
          context.sequence,
        ),
      ).id;
    })
    .build();
  const { A: big, B: small } = ids.promotions;
  if (big === undefined || small === undefined || free === undefined) {
    throw new Error('reach world: missing ids');
  }
  return { world, big, small, free };
}

/** The worker's own ask as an offer. */
function offerAtAsk(terms: AskingTerms): Offer {
  return {
    terms: askTermsOf(terms),
    startsOn: null,
    lengthMonths: terms.preferredLengthMonths.value,
    brand: { kind: 'shared' },
    role: terms.role,
    push: terms.expectedPush.value,
    extra: {},
  };
}

/** The ask as an offer with only the monthly wage cut to `share` of it. */
function wageAt(offer: Offer, share: number): Offer {
  return {
    ...offer,
    terms: { ...offer.terms, monthlyWage: cents(Math.round(offer.terms.monthlyWage * share)) },
  };
}

function preview(
  world: GameWorld,
  args: { promotionId: PromotionId; personId: PersonId; offer: Offer },
): OfferPreview {
  const result = ask(negotiationEngine(world).query('contracts.offerPreview', args, PLAYER_VIEW));
  expectSerialisable(result);
  return result;
}

function askAt(world: GameWorld, promotionId: PromotionId, personId: PersonId): AskingTerms {
  return askingTermsFor(world, createEngineTunables(), {
    promotionId,
    personId,
    date: world.meta.currentDate,
  });
}

describe('reactions in a world', () => {
  it('likes the ask, counters 60%, rejects 50% and walks away from 40%', () => {
    const setup = reachWorld();
    const terms = askAt(setup.world, setup.big, setup.free);
    expect(terms.kind).toBe('written');
    expect(terms.signingBonus.value).toBe(terms.monthlyWage.value);
    const atAsk = offerAtAsk(terms);
    const args = { promotionId: setup.big, personId: setup.free };

    const likely = preview(setup.world, { ...args, offer: atAsk });
    expect(likely).toMatchObject({ reaction: 'accept', band: 'likely', label: 'Likely to accept' });
    // The meter's band boundaries (ECO5-06) are the reaction tunables.
    expect(likely.thresholds).toEqual({ walkAway: 0.45, counter: 0.55, accept: 0.95 });
    expect(likely.ratio).toBe(1);
    expect(likely.offerValue).toBe(likely.askValue);
    expect(likely.notes).toContain(LIKELY_NOTE);
    expect(likely.patienceLeft).toBe(likely.startPatience);

    const counter = preview(setup.world, { ...args, offer: wageAt(atAsk, 0.6) });
    expect(counter).toMatchObject({ reaction: 'counter', band: 'counter', label: 'Will counter' });
    expect(counter.ratio).toBeCloseTo(0.616, 3);
    expect(counter.notes).toContain(PART_OF_THE_WAY_NOTE);
    expect(counter.patienceLeft).toBe(counter.startPatience - 1);

    const reject = preview(setup.world, { ...args, offer: wageAt(atAsk, 0.5) });
    expect(reject).toMatchObject({ reaction: 'reject', band: 'reject', label: 'Will reject' });
    expect(reject.ratio).toBeCloseTo(0.52, 2);

    const walk = preview(setup.world, { ...args, offer: wageAt(atAsk, 0.4) });
    expect(walk).toMatchObject({ reaction: 'walkAway', band: 'walkAway', label: 'Will walk away' });
    expect(walk.ratio).toBeCloseTo(0.424, 3);
    expect(walk.patienceLeft).toBe(0);
  });

  it('asks less of a promotion with lower reach, but the same share decides', () => {
    const setup = reachWorld();
    const tunables = createEngineTunables();
    expect(reachOf(setup.world, setup.small, tunables).reach.value).toBeLessThan(
      reachOf(setup.world, setup.big, tunables).reach.value,
    );
    for (const share of [1, 0.6, 0.5, 0.4]) {
      const [big, small] = [setup.big, setup.small].map((promotionId) =>
        preview(setup.world, {
          promotionId,
          personId: setup.free,
          offer: wageAt(offerAtAsk(askAt(setup.world, promotionId, setup.free)), share),
        }),
      );
      if (big === undefined || small === undefined) {
        throw new Error('missing previews');
      }
      expect(small.askValue).toBeLessThan(big.askValue);
      expect(small.ratio).toBeCloseTo(big.ratio, 3);
      expect(small.reaction).toBe(big.reaction);
    }
  });

  it('agrees with evaluateOffer, and every value replays', () => {
    const setup = reachWorld();
    const tunables = createEngineTunables();
    const offer = wageAt(offerAtAsk(askAt(setup.world, setup.big, setup.free)), 0.7);
    const evaluation = evaluateOffer(setup.world, tunables, {
      promotionId: setup.big,
      personId: setup.free,
      offer,
      negotiation: null,
      date: setup.world.meta.currentDate,
    });
    expectTraceReplays(evaluation.offerValue);
    expectTraceReplays(evaluation.askValue);
    expectSerialisable(evaluation.reaction);
    const shown = preview(setup.world, { promotionId: setup.big, personId: setup.free, offer });
    expect(shown.reaction).toBe(evaluation.reaction.value);
    expect(shown.reactionTrace).toEqual(evaluation.reaction.trace);
    expect(shown.valueTrace).toEqual(evaluation.offerValue.trace);
    expect(shown.askValueTrace).toEqual(evaluation.askValue.trace);
  });

  it('has no counter band when the counter line meets the accept line', () => {
    const setup = reachWorld();
    const atAsk = offerAtAsk(askAt(setup.world, setup.big, setup.free));
    const react = (share: number, overrides: TunableOverrides) =>
      evaluateOffer(setup.world, createEngineTunables(overrides), {
        promotionId: setup.big,
        personId: setup.free,
        offer: wageAt(atAsk, share),
        negotiation: null,
        date: setup.world.meta.currentDate,
      }).reaction.value;
    const merged = { 'contracts.react.counterRatio': 0.95 };
    expect([1, 0.9, 0.6, 0.5].map((share) => react(share, merged))).toEqual([
      'accept',
      'reject',
      'reject',
      'reject',
    ]);
    // With no patience at all, everything short of an acceptance is a walk-away.
    const none = { 'contracts.patience.base': 0 };
    expect([1, 0.9, 0.6, 0.5, 0.4].map((share) => react(share, none))).toEqual([
      'accept',
      'walkAway',
      'walkAway',
      'walkAway',
      'walkAway',
    ]);
  });

  it('accepts an offer that meets their last counter-offer', () => {
    const setup = reachWorld();
    const atAsk = offerAtAsk(askAt(setup.world, setup.big, setup.free));
    const countered = wageAt(atAsk, 0.8);
    const negotiation = aNegotiation({
      personId: setup.free,
      promotionId: setup.big,
      status: 'countered',
      round: 2,
      offer: wageAt(atAsk, 0.6),
      lastCounter: countered,
      counterExpiresOn: addDays(setup.world.meta.currentDate, 7),
    });
    const evaluate = (offer: Offer) =>
      evaluateOffer(setup.world, createEngineTunables(), {
        promotionId: setup.big,
        personId: setup.free,
        offer,
        negotiation,
        date: setup.world.meta.currentDate,
      });
    const matched = evaluate(countered);
    expect(matched.reaction.value).toBe('accept');
    expect(matched.reaction.trace).toMatchObject({ reason: MATCHES_COUNTER_REASON });
    expect(evaluate(wageAt(atAsk, 0.85)).reaction.value).toBe('accept');
    // Anything else is weighed as usual (patience from the negotiation).
    expect(
      evaluate({ ...countered, lengthMonths: countered.lengthMonths + 1 }).reaction.value,
    ).toBe('counter');
  });
});

describe('contracts.offerPreview refusals', () => {
  it('refuses a worker cooling off after walking away from you', () => {
    const setup = negotiationWorld();
    const offer = offerAtAsk(askAt(setup.world, setup.human, setup.free));
    const shown = preview(setup.world, { promotionId: setup.human, personId: setup.free, offer });
    expect(shown).toMatchObject({ reaction: 'refuse', band: 'refuse', label: "Won't sign" });
    expect(shown.notes[0]).toMatch(/^Walked away from talks with you; will talk again on /);
    const evaluation = evaluateOffer(setup.world, createEngineTunables(), {
      promotionId: setup.human,
      personId: setup.free,
      offer,
      negotiation: null,
      date: setup.today,
    });
    expect(evaluation.refusal?.code).toBe(COOLING_OFF_CODE);
  });

  it('refuses a renewal while deeply unhappy, and a role they will not take', () => {
    const setup = negotiationWorld();
    const personId = setup.person(setup.mine);
    setMorale(setup.world, setup.mine, -70);
    const engine = negotiationEngine(setup.world);
    const renewalAsk = askingTermsFor(setup.world, createEngineTunables(), {
      promotionId: setup.human,
      personId,
      date: setup.today,
      renewalOf: setup.mine,
    });
    const renewal = ask(
      engine.query(
        'contracts.offerPreview',
        {
          promotionId: setup.human,
          personId,
          offer: offerAtAsk(renewalAsk),
          renewalOf: setup.mine,
        },
        PLAYER_VIEW,
      ),
    );
    expect(renewal.band).toBe('refuse');
    expect(renewal.notes).toContain(REFUSES_RENEWAL_MESSAGE);

    const veteran = setup.world.tables.people.require(setup.veteran);
    const offer = {
      ...offerAtAsk(askAt(setup.world, setup.human, setup.veteran)),
      role: 'referee' as const,
    };
    const reason = roleMismatch(veteran, 'referee', { tunables: createEngineTunables() });
    expect(reason).not.toBeNull();
    const shown = preview(setup.world, {
      promotionId: setup.human,
      personId: setup.veteran,
      offer,
    });
    expect(shown.band).toBe('refuse');
    expect(shown.notes).toContain(reason);
  });

  it('says when a perk adds nothing because the game does not honour it', () => {
    const setup = reachWorld();
    const atAsk = offerAtAsk(askAt(setup.world, setup.big, setup.free));
    const withControl: Offer = {
      ...atAsk,
      terms: { ...atAsk.terms, perks: { ...atAsk.terms.perks, creativeControl: true } },
    };
    const plain = preview(setup.world, {
      promotionId: setup.big,
      personId: setup.free,
      offer: atAsk,
    });
    const shown = preview(setup.world, {
      promotionId: setup.big,
      personId: setup.free,
      offer: withControl,
    });
    expect(shown.offerValue).toBe(plain.offerValue);
    expect(shown.notes).toContain(notEnforcedLine('Creative control'));
  });

  it('answers only for your own promotions and your own open talks', () => {
    const setup = negotiationWorld();
    const engine = negotiationEngine(setup.world);
    const args = {
      promotionId: setup.human,
      personId: setup.veteran,
      offer: offerAtAsk(askAt(setup.world, setup.human, setup.veteran)),
    };
    for (const view of [OTHER_VIEW, OMNISCIENT]) {
      const refused = engine.query('contracts.offerPreview', args, view);
      expect(refused.ok).toBe(false);
    }
    const rival = engine.query(
      'contracts.offerPreview',
      { ...args, promotionId: setup.rival },
      PLAYER_VIEW,
    );
    expect(rival.ok).toBe(false);
    // The rival's open talks with the free agent are not yours.
    const rivalTalks = setup.world.tables.negotiations
      .values()
      .find((negotiation) => negotiation.promotionId === setup.rival);
    const notMine = engine.query(
      'contracts.offerPreview',
      { ...args, personId: setup.free, negotiationId: rivalTalks?.id },
      PLAYER_VIEW,
    );
    expect(notMine).toMatchObject({
      ok: false,
      reasons: [
        { code: INVALID_ARGS, message: UNKNOWN_NEGOTIATION_MESSAGE, field: 'negotiationId' },
      ],
    });
  });
});
