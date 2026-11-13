// Planning a card. Design: docs/design/rival-booking.md#planning-a-card
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../../src/core/date';
import type { PersonId } from '../../../../src/core/ids';
import { RngRegistry } from '../../../../src/core/rng/registry';
import {
  assertTraceReplays,
  traceNodeSchema,
  walkTrace,
  type TraceNode,
} from '../../../../src/core/trace';
import type { EventImportance } from '../../../../src/model/entities/event-definition';
import type { Person } from '../../../../src/model/entities/person';
import { cardSegments } from '../../../../src/systems/booking/card';
import { structuralProblems } from '../../../../src/systems/booking/writer';
import {
  CARD_PLAN_STREAM,
  cancelReason,
  MAIN_EVENT_MATCH_RULE,
  HOT_OPENER_RULE,
  planCard,
  storedTaste,
  type CardPlan,
  type PlanCardMode,
  type PlannedPlacement,
} from '../../../../src/systems/aip';
import type { Taste } from '../../../../src/model/entities/ai-profile';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import {
  anAngle,
  anEventInstance,
  aMatch,
  aParticipant,
  aStoryline,
  DEFAULT_BEAT_KEY,
} from '../../../support/builders/creative';
import { anAiProfile } from '../../../support/builders/promotions';
import { flatAttributes } from '../../../support/builders/people';
import { TEST_START_DATE, type DeepPartial } from '../../../support/builders/build-row';
import { expectSerialisable } from '../../../support/trace';
import { worldBuilder, type BuiltWorld } from '../../../support/world-builder';

const TODAY = TEST_START_DATE;
const LONG_AGO = addDays(TODAY, -400);
const defaults = createEngineTunables();

interface WorldSpec {
  readonly roster: number;
  readonly slots?: number;
  readonly preShowSlots?: number;
  readonly importance?: EventImportance;
  readonly person?: (index: number) => DeepPartial<Person>;
  /** Roster index of a singles champion. */
  readonly champion?: number;
  /** Roster index of the promotion's ace. */
  readonly ace?: number;
  /** Segments already on the card: a match between 0 and 1 in main slot 1, a promo by 2 in 3. */
  readonly booked?: boolean;
  readonly storyline?: readonly [number, number];
}

/** Ability 90 for index 0, then 3 less per index. */
function ranked(index: number): DeepPartial<Person> {
  return { attributes: flatAttributes(Math.max(10, 90 - index * 3)) };
}

function planWorld(spec: WorldSpec): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion({ controller: { kind: 'computer' } }, (promotion) => {
      promotion.withRoster(spec.roster, {
        person: (index) => ({ ...ranked(index), ...spec.person?.(index) }),
        employment: (index) => ({ alignment: index % 2 === 0 ? 'face' : 'heel' }),
      });
      if (spec.champion !== undefined) {
        promotion.withTitle(
          { name: 'Test Title', introducedOn: LONG_AGO, prestige: 70 },
          { holder: spec.champion, wonOn: addDays(TODAY, -90) },
        );
      }
    })
    .with('tonight', (context) => {
      const person = (index: number): PersonId => {
        const id = context.ids.people[index];
        if (id === undefined) {
          throw new Error(`no person ${String(index)}`);
        }
        return id;
      };
      const promotionId = context.ids.promotions.A;
      const [regionId] = context.ids.regions;
      if (promotionId === undefined || regionId === undefined) {
        throw new Error('the plan world needs a promotion and a region');
      }
      if (spec.ace !== undefined) {
        const employmentId = context.ids.employments[spec.ace];
        if (employmentId === undefined) {
          throw new Error('no ace contract');
        }
        context.insert(
          'aiProfiles',
          anAiProfile(
            {
              promotionId,
              featured: {
                ace: { employmentId, since: LONG_AGO },
                prospects: [],
                nextReviewOn: addDays(TODAY, 30),
                lastReviewedOn: TODAY,
              },
            },
            context.sequence,
          ),
        );
      }
      if (spec.storyline !== undefined) {
        context.insert(
          'storylines',
          aStoryline(
            {
              promotionId,
              heat: 90,
              name: 'Hot Feud',
              members: [
                { personId: person(spec.storyline[0]), side: 'face' },
                { personId: person(spec.storyline[1]), side: 'heel' },
              ],
            },
            context.sequence,
          ),
        );
      }
      const instance = context.insert(
        'eventInstances',
        anEventInstance(
          {
            promotionId,
            regionId,
            name: 'Tonight',
            importance: spec.importance ?? 'regular',
            format: { slots: spec.slots ?? 6, preShowSlots: spec.preShowSlots ?? 0 },
            date: TODAY,
          },
          context.sequence,
        ),
      );
      if (spec.booked === true) {
        const match = context.insert(
          'segments',
          aMatch({ eventInstanceId: instance.id, slot: 1, preShow: false }, context.sequence),
        );
        for (const [side, index] of [0, 1].entries()) {
          context.insert(
            'participants',
            aParticipant({ segmentId: match.id, personId: person(index), side }, context.sequence),
          );
        }
        const promo = context.insert(
          'segments',
          anAngle(
            {
              eventInstanceId: instance.id,
              slot: 3,
              preShow: false,
              angle: { beats: [{ beatKey: DEFAULT_BEAT_KEY, personIds: [person(2)] }] },
            },
            context.sequence,
          ),
        );
        context.insert(
          'participants',
          aParticipant(
            { segmentId: promo.id, personId: person(2), side: 0, role: 'speaker' },
            context.sequence,
          ),
        );
      }
    })
    .build();
}

function tonightOf(built: BuiltWorld) {
  const instance = built.world.tables.eventInstances.values().find((row) => row.name === 'Tonight');
  if (instance === undefined) {
    throw new Error('no show tonight');
  }
  return instance;
}

function tasteWith(talkShare: number): ReturnType<typeof storedTaste> {
  const taste: Taste = {
    wrestlingFocus: 50,
    entertainmentFocus: 50,
    athleticFocus: 50,
    starFocus: 50,
    talkShare,
    titleFocus: 50,
    youthFocus: 50,
    riskAppetite: 50,
  };
  return storedTaste(taste);
}

interface PlanOptions {
  readonly seed?: string;
  readonly mode?: PlanCardMode;
  readonly tunables?: EngineTunables;
  readonly talkShare?: number;
}

function plan(built: BuiltWorld, options: PlanOptions = {}): CardPlan {
  const tunables = options.tunables ?? defaults;
  const result = planCard(
    built.world,
    {
      instance: tonightOf(built),
      today: TODAY,
      mode: options.mode ?? 'fresh',
      ...(options.talkShare === undefined ? {} : { taste: tasteWith(options.talkShare) }),
    },
    { tunables, rng: new RngRegistry(options.seed ?? 'plan-seed').stream(CARD_PLAN_STREAM) },
  );
  expectSound(built, result, options.mode ?? 'fresh');
  return result;
}

/** Every numeric calculation inside `node` replays. */
function expectCalcsReplay(node: TraceNode): void {
  walkTrace(node, (child) => {
    // Card scores and the plan's own shape; nested inputs from other formulas are not standalone.
    const ours = /^(Card score: |Title matches left tonight)/.test(child.label);
    if (ours && child.kind === 'formula' && typeof child.value === 'number') {
      assertTraceReplays({ value: child.value, trace: child });
    }
  });
}

/** The rules every plan keeps. */
function expectSound(built: BuiltWorld, result: CardPlan, mode: PlanCardMode): void {
  expectSerialisable(result);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  expect(traceNodeSchema.safeParse(result.planTrace.trace).success).toBe(true);
  expectCalcsReplay(result.planTrace.trace);
  if (result.kind !== 'card') {
    return;
  }
  const instance = tonightOf(built);
  const { slots, preShowSlots } = instance.format;
  const keys = new Set<string>();
  for (const placement of result.placements) {
    const key = `${String(placement.preShow)}:${String(placement.slot)}`;
    expect(keys.has(key)).toBe(false);
    keys.add(key);
    expect(placement.slot).toBeLessThan(placement.preShow ? preShowSlots : slots);
    if (placement.preShow) {
      expect(placement.draft.kind).toBe('match');
    }
    expect(traceNodeSchema.safeParse(placement.slotTrace.trace).success).toBe(true);
    expectCalcsReplay(placement.slotTrace.trace);
    expect(placement.headline.length).toBeGreaterThanOrEqual(2);
    expect(placement.headline.length).toBeLessThanOrEqual(3);
    // Player-facing reasons: card scores and heat in whole points (AIP4-08).
    for (const line of placement.headline) {
      expect(line).not.toMatch(/(Card score|heat) \d+\.\d/);
    }
    const problems = structuralProblems(built.world, {
      instance,
      draft: placement.draft,
      target: { preShow: placement.preShow, slot: placement.slot },
    });
    // A fresh plan replaces whatever is on the card, so a taken slot is expected there.
    expect(
      problems.filter((problem) => mode === 'keepFilled' || problem.code !== 'slotTaken'),
    ).toEqual([]);
  }
  const main = mainCardOf(built, result, mode);
  for (let slot = 1; slot < main.length; slot++) {
    expect(
      main[slot - 1] === 'angle' && main[slot] === 'angle',
      `talking in slots ${String(slot)} and ${String(slot + 1)}`,
    ).toBe(false);
  }
}

/** The main card's kinds, kept segments included, slot 0 first (null when empty). */
function mainCardOf(built: BuiltWorld, result: CardPlan, mode: PlanCardMode): (string | null)[] {
  const instance = tonightOf(built);
  const card: (string | null)[] = Array.from({ length: instance.format.slots }, () => null);
  for (const segment of cardSegments(built.world, instance.id)) {
    if (!segment.preShow) {
      card[segment.slot] = segment.kind;
    }
  }
  if (result.kind === 'card') {
    if (mode === 'fresh') {
      card.fill(null);
    }
    for (const placement of result.placements) {
      if (!placement.preShow) {
        card[placement.slot] = placement.draft.kind;
      }
    }
  }
  // Empty slots are skipped in running order.
  return card.filter((kind) => kind !== null);
}

function cardOf(result: CardPlan): PlannedPlacement[] {
  if (result.kind !== 'card') {
    throw new Error(`expected a card, got: ${result.reason}`);
  }
  return [...result.placements];
}

function mainOf(result: CardPlan): PlannedPlacement[] {
  return cardOf(result)
    .filter((placement) => !placement.preShow)
    .sort((left, right) => left.slot - right.slot);
}

const SEEDS = ['plan-a', 'plan-b', 'plan-c', 'plan-d', 'plan-e'];

describe('planCard', () => {
  const regular = planWorld({ roster: 18, champion: 0, slots: 6 });

  it('closes a regular show with its highest-scoring match and opens with the second best', () => {
    for (const seed of SEEDS) {
      const main = mainOf(plan(regular, { seed }));
      const matches = main.filter((placement) => placement.draft.kind === 'match');
      const scores = matches
        .map((placement) => placement.cardScore)
        .sort((left, right) => right - left);
      const last = main.at(-1);
      expect(last?.slot).toBe(5);
      expect(last?.draft.kind).toBe('match');
      expect(last?.cardScore).toBe(scores[0]);
      expect(last?.headline[0]).toBe(MAIN_EVENT_MATCH_RULE);
      if (matches.length >= 3 && main[0]?.draft.kind === 'match') {
        expect(main[0].cardScore).toBe(scores[1]);
        expect(main[0].headline[0]).toBe(HOT_OPENER_RULE);
      }
    }
  });

  it('names the role, the score and the rule in every slot trace', () => {
    const main = mainOf(plan(regular));
    const last = main.at(-1);
    expect(last?.slotTrace.trace.label).toBe('Slot 6 · Main event');
    const labels = (last?.slotTrace.trace.children ?? []).map((node) => node.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Slot role',
        'Why this segment',
        'Card score',
        MAIN_EVENT_MATCH_RULE,
      ]),
    );
    expect(main[0]?.slotTrace.trace.label).toBe('Slot 1 · Opener');
  });

  it('never puts two talking segments together, for any format or taste', () => {
    for (const slots of [3, 6, 8, 10]) {
      const built = planWorld({ roster: 24, slots });
      for (const talkShare of [0, 50, 100]) {
        const result = plan(built, { talkShare, seed: `talk-${String(slots)}` });
        const main = mainOf(result);
        expect(main.length).toBeLessThanOrEqual(slots);
        expect(main.at(-1)?.draft.kind).toBe('match');
        if (talkShare === 100 && slots >= 6) {
          expect(main.some((placement) => placement.draft.kind === 'angle')).toBe(true);
        }
      }
    }
  });

  it('lets a house show end on its best segment', () => {
    const built = planWorld({ roster: 12, slots: 4, importance: 'house' });
    const main = mainOf(plan(built));
    const best = Math.max(...main.map((placement) => placement.cardScore));
    expect(main.at(-1)?.cardScore).toBe(best);
  });

  it('puts only matches on the pre-show, the lowest-scoring ones', () => {
    const built = planWorld({ roster: 24, slots: 5, preShowSlots: 2 });
    const card = cardOf(plan(built));
    const pre = card.filter((placement) => placement.preShow);
    expect(pre).toHaveLength(2);
    const lowestMain = Math.min(
      ...card
        .filter((placement) => !placement.preShow && placement.draft.kind === 'match')
        .map((placement) => placement.cardScore),
    );
    for (const placement of pre) {
      expect(placement.draft.kind).toBe('match');
      expect(placement.cardScore).toBeLessThanOrEqual(lowestMain);
    }
  });

  it('leaves the pre-show empty with the flag off', () => {
    const built = planWorld({ roster: 24, slots: 5, preShowSlots: 2 });
    const tunables = createEngineTunables({ 'aip.card.fillPreShow': false });
    const card = cardOf(plan(built, { tunables }));
    expect(card.some((placement) => placement.preShow)).toBe(false);
  });

  it('keeps every segment already on the card and fills only the open slots', () => {
    const built = planWorld({ roster: 18, slots: 6, booked: true });
    const before = JSON.stringify(cardSegments(built.world, tonightOf(built).id));
    const result = plan(built, { mode: 'keepFilled' });
    expect(JSON.stringify(cardSegments(built.world, tonightOf(built).id))).toBe(before);
    const card = cardOf(result);
    expect(card.map((placement) => placement.slot).sort()).toEqual([0, 2, 4, 5]);
    const people = card.flatMap((placement) =>
      placement.draft.participants
        .filter(() => placement.draft.kind === 'match')
        .map((participant) => participant.personId),
    );
    // The two already wrestling tonight are never booked into another match.
    expect(people).not.toContain(built.ids.people[0]);
    expect(people).not.toContain(built.ids.people[1]);
  });

  it('plans over the kept card in fresh mode', () => {
    const built = planWorld({ roster: 18, slots: 6, booked: true });
    expect(cardOf(plan(built, { mode: 'fresh' }))).toHaveLength(6);
  });

  it('cancels a show with too few wrestlers, saying why', () => {
    const built = planWorld({
      roster: 6,
      person: (index) => (index < 2 ? { fatigue: 95 } : {}),
    });
    const result = plan(built);
    expect(result.kind).toBe('cancel');
    if (result.kind === 'cancel') {
      expect(result.reason).toBe(cancelReason(4, 5));
      expect(result.reason).toBe('Only 4 wrestlers available, needs 5');
      const lines = (result.planTrace.trace.children ?? []).map((node) => node.label);
      expect(lines.some((line) => line.includes('Tired (fatigue 95'))).toBe(true);
    }
  });

  it("moves the ace's match up the card", () => {
    // The ace is the weakest wrestler on the roster.
    const plain = planWorld({ roster: 12, slots: 4 });
    const featured = planWorld({ roster: 12, slots: 4, ace: 11 });
    const tunables = createEngineTunables({ 'aip.card.order.aceBoost': 50 });
    const slotOf = (result: CardPlan, personId: PersonId | undefined): number | undefined =>
      mainOf(result).find(
        (placement) =>
          placement.draft.kind === 'match' &&
          placement.draft.participants.some((participant) => participant.personId === personId),
      )?.slot;
    let higher = 0;
    for (const seed of SEEDS) {
      const without = slotOf(plan(plain, { seed, tunables }), plain.ids.people[11]);
      const withAce = slotOf(plan(featured, { seed, tunables }), featured.ids.people[11]);
      if (without !== undefined && withAce !== undefined && withAce > without) {
        higher += 1;
      }
      // A match with the ace in it closes the show.
      if (withAce !== undefined) {
        expect(withAce).toBe(3);
      }
    }
    expect(higher).toBeGreaterThan(0);
  });

  it('gives the same plan for the same seed', () => {
    const first = plan(regular, { seed: 'same' });
    const second = plan(regular, { seed: 'same' });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('counts what it planned', () => {
    const built = planWorld({ roster: 18, champion: 0, slots: 6, storyline: [2, 3] });
    const result = plan(built);
    if (result.kind !== 'card') {
      throw new Error('expected a card');
    }
    const card = cardOf(result);
    expect(result.counts.matches + result.counts.talking).toBe(card.length);
    expect(result.counts.storyline).toBe(
      card.filter((placement) => placement.source === 'storyline').length,
    );
    expect(result.planTrace.trace.label).toBe('Card plan: Tonight');
  });
});
