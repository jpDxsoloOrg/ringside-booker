// The rating seams (MTCH1-05): rating modifiers on every stage, their order, the rival shortcut,
// the policy door and swapping a rater. Design: docs/design/match-rating.md#pipeline-and-seams
import { afterEach, describe, expect, it } from 'vitest';
import { RegistryError } from '../../../../src/core/errors';
import { constantOf, findTraceNodes } from '../../../../src/core/trace';
import {
  DEFAULT_POLICY_LABEL,
  NEUTRAL_RATING_POLICY,
  RATING_ORDER,
  RATING_STAGES,
  ratingModifiersFor,
  ratingPolicyFor,
  registerRatingModifier,
  registerRatingPolicyProvider,
  registerSegmentRater,
  resetMatchRegistriesForTests,
  segmentRaterFor,
  skippedDetailNote,
  type RatingModifier,
  type RatingPolicy,
  type RatingStage,
} from '../../../../src/systems/match';
import { expectTraceReplays } from '../../../support/trace';
import {
  DEFAULT_TUNABLES,
  addsLabelled,
  inputOf,
  rate,
  stepsLabelled,
  tinyRating,
} from './fixtures';

const BUMP = 'Test bump';

afterEach(() => {
  resetMatchRegistriesForTests();
});

/** A modifier that adds `amount` on `stage`, labelled `label`. */
function bump(
  id: string,
  stage: RatingStage,
  options: Partial<Pick<RatingModifier, 'order' | 'detail' | 'applies'>> & {
    amount?: number;
    label?: string;
  } = {},
): RatingModifier {
  const amount = options.amount ?? 2;
  return {
    id,
    stage,
    order: options.order ?? RATING_ORDER.normal,
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    applies: options.applies ?? (() => true),
    apply: (calc) => {
      calc.add(options.label ?? BUMP, amount);
    },
  };
}

function policy(overrides: Partial<RatingPolicy>): RatingPolicy {
  return { ...NEUTRAL_RATING_POLICY, label: 'Test policy', lines: ['Test policy'], ...overrides };
}

describe('rating modifiers on each stage', () => {
  const { world, mainEvent, promo } = tinyRating();
  const matchInput = inputOf(world, mainEvent.id);
  const angleInput = inputOf(world, promo.id);
  const baseMatch = rate(world, matchInput);
  const baseAngle = rate(world, angleInput);

  it('adds one labelled performance line per worker and axis, moving it by the amount', () => {
    registerRatingModifier(bump('test.performance', 'performance'));
    const rated = rate(world, matchInput);
    for (const [index, line] of rated.workers.entries()) {
      const before = baseMatch.workers[index];
      expect(line.inRing).not.toBeNull();
      if (line.inRing === null || before?.inRing == null) {
        throw new Error('missing in-ring line');
      }
      expect(stepsLabelled(line.inRing, BUMP)).toHaveLength(1);
      expect(line.inRing.value).toBeCloseTo(before.inRing.value + 2, 9);
      expect(stepsLabelled(line.entertainment, BUMP)).toHaveLength(1);
      expect(line.entertainment.value).toBeCloseTo(before.entertainment.value + 2, 9);
      expectTraceReplays(line.inRing);
    }
  });

  it('adds one labelled side line per side inside work rate', () => {
    const subjects: number[] = [];
    registerRatingModifier(
      bump('test.side', 'side', {
        applies: (_ctx, subject) => {
          if (subject?.kind === 'side') {
            subjects.push(subject.side);
          }
          return subject?.kind === 'side';
        },
      }),
    );
    const rated = rate(world, matchInput);
    if (rated.workRate === null) {
      throw new Error('a match has a work rate');
    }
    const lines = addsLabelled(rated.workRate, BUMP);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.kind === 'add' ? line.after - line.before : null).toBe(2);
    }
    expect(subjects).toEqual([0, 1]);
    expect(rated.workRate.value).toBeGreaterThan(baseMatch.workRate?.value ?? Infinity);
    expectTraceReplays(rated.workRate);
  });

  it.each([
    ['workRate', (result: typeof baseMatch) => result.workRate],
    ['expectation', (result: typeof baseMatch) => result.expectation],
    ['crowd', (result: typeof baseMatch) => result.crowd],
    ['score', (result: typeof baseMatch) => result.score],
    ['stars', (result: typeof baseMatch) => result.stars],
  ] as const)('adds one labelled %s line to a match, moving it by the amount', (stage, pick) => {
    // Stars move by a whole star; the rest by 2 points (below the compression knee).
    const amount = stage === 'stars' ? 1 : 2;
    registerRatingModifier(bump(`test.${stage}`, stage, { amount }));
    const rated = rate(world, matchInput);
    const value = pick(rated);
    const before = pick(baseMatch);
    if (value === null || before === null) {
      throw new Error(`no ${stage} value`);
    }
    expect(stepsLabelled(value, BUMP)).toHaveLength(1);
    expect(value.value).toBeCloseTo(before.value + amount, 9);
    expectTraceReplays(value);
  });

  it('adds one labelled talk line to a talking segment', () => {
    registerRatingModifier(bump('test.talk', 'talk'));
    const rated = rate(world, angleInput);
    if (rated.talk === null || baseAngle.talk === null) {
      throw new Error('a talking segment has talk');
    }
    expect(stepsLabelled(rated.talk, BUMP)).toHaveLength(1);
    expect(rated.talk.value).toBeCloseTo(baseAngle.talk.value + 2, 9);
    expectTraceReplays(rated.talk);
  });

  it('never runs a work rate modifier on a talking segment or a talk modifier on a match', () => {
    const undo = registerRatingModifier(bump('test.workRate', 'workRate'));
    expect(rate(world, angleInput)).toEqual(baseAngle);
    undo();
    registerRatingModifier(bump('test.talk', 'talk'));
    expect(rate(world, matchInput)).toEqual(baseMatch);
  });

  it('skips a modifier whose applies is false and adds no line', () => {
    registerRatingModifier(bump('test.never', 'score', { applies: () => false }));
    const rated = rate(world, matchInput);
    expect(rated.score).toEqual(baseMatch.score);
  });

  it('keeps a stage finished: the score stays whole and within 0..100', () => {
    registerRatingModifier(bump('test.huge', 'score', { amount: 500.4 }));
    const rated = rate(world, matchInput);
    expect(rated.score.value).toBe(100);
    expectTraceReplays(rated.score);
  });

  it('covers every stage', () => {
    expect([...RATING_STAGES]).toEqual([
      'performance',
      'side',
      'workRate',
      'talk',
      'expectation',
      'crowd',
      'score',
      'stars',
    ]);
  });
});

describe('modifier order and registration', () => {
  it('runs lower orders first and equal orders by id', () => {
    const { world, mainEvent } = tinyRating();
    registerRatingModifier(bump('test.beta', 'score', { order: 50, label: 'beta', amount: 1 }));
    registerRatingModifier(bump('test.alpha', 'score', { order: 50, label: 'alpha', amount: 1 }));
    registerRatingModifier(
      bump('test.first', 'score', { order: RATING_ORDER.early, label: 'first', amount: 1 }),
    );
    registerRatingModifier(
      bump('test.last', 'score', { order: RATING_ORDER.late, label: 'last', amount: 1 }),
    );
    expect(ratingModifiersFor('score').map((modifier) => modifier.id)).toEqual([
      'test.first',
      'test.alpha',
      'test.beta',
      'test.last',
    ]);
    const rated = rate(world, inputOf(world, mainEvent.id));
    const labels = findTraceNodes(rated.score.trace, 'add')
      .map((node) => node.label)
      .filter((label) => ['first', 'alpha', 'beta', 'last'].includes(label));
    expect(labels).toEqual(['first', 'alpha', 'beta', 'last']);
  });

  it('exports the named orders', () => {
    expect(RATING_ORDER).toEqual({ early: 10, normal: 50, late: 90 });
  });

  it('throws on a duplicate id, a malformed id, an order outside 1..99 or an unknown stage', () => {
    registerRatingModifier(bump('test.once', 'score'));
    expect(() => registerRatingModifier(bump('test.once', 'crowd'))).toThrow(RegistryError);
    expect(() => registerRatingModifier(bump('NotAnId', 'score'))).toThrow(/system\.camelName/);
    expect(() => registerRatingModifier(bump('test.zero', 'score', { order: 0 }))).toThrow(
      /1 to 99/,
    );
    expect(() => registerRatingModifier(bump('test.hundred', 'score', { order: 100 }))).toThrow(
      /1 to 99/,
    );
    expect(() => registerRatingModifier(bump('test.half', 'score', { order: 1.5 }))).toThrow(
      /1 to 99/,
    );
    const badStage = bump('test.stage', 'score');
    Reflect.set(badStage, 'stage', 'minutes');
    expect(() => registerRatingModifier(badStage)).toThrow(/unknown stage "minutes"/);
  });

  it('removes a modifier with the function it returns', () => {
    const unregister = registerRatingModifier(bump('test.temporary', 'score'));
    expect(ratingModifiersFor('score')).toHaveLength(1);
    unregister();
    expect(ratingModifiersFor('score')).toHaveLength(0);
  });

  it('restores the built-ins on reset', () => {
    registerRatingModifier(bump('test.extra', 'crowd'));
    registerRatingPolicyProvider(() => NEUTRAL_RATING_POLICY);
    registerSegmentRater(
      'angle',
      () => {
        throw new Error('not used');
      },
      { replace: true },
    );
    resetMatchRegistriesForTests();
    // The finish effect modifiers (MTCH2-02) are built-ins; the extra is gone.
    expect(ratingModifiersFor('crowd').map((modifier) => modifier.id)).toEqual([
      'match.finishCrowd',
    ]);
    expect(segmentRaterFor('match')).toBeDefined();
    const { world, promo } = tinyRating();
    expect(rate(world, inputOf(world, promo.id)).kind).toBe('angle');
  });
});

describe('the rival shortcut: simple booking inputs', () => {
  it('skips a detail modifier with a note and keeps the others', () => {
    const { world, mainEvent } = tinyRating();
    const input = inputOf(world, mainEvent.id);
    const base = rate(world, input);
    registerRatingPolicyProvider(() => policy({ simpleInputs: true }), { id: 'test.simple' });
    registerRatingModifier(bump('test.detailed', 'score', { detail: true, amount: 5 }));
    registerRatingModifier(bump('test.plain', 'score', { amount: 1, label: 'Plain' }));
    const rated = rate(world, input);
    expect(stepsLabelled(rated.score, skippedDetailNote('test.detailed'))).toHaveLength(1);
    expect(skippedDetailNote('test.detailed')).toBe(
      'Rival shortcut: simple booking inputs, test.detailed skipped',
    );
    expect(stepsLabelled(rated.score, BUMP)).toHaveLength(0);
    expect(stepsLabelled(rated.score, 'Plain')).toHaveLength(1);
    expect(rated.score.value).toBe(base.score.value + 1);
    expect(rated.policy).toEqual({
      label: 'Test policy',
      simpleInputs: true,
      skipInMatchInjuries: false,
    });
  });

  it('runs a detail modifier under the full rules', () => {
    const { world, mainEvent } = tinyRating();
    const input = inputOf(world, mainEvent.id);
    const base = rate(world, input);
    registerRatingModifier(bump('test.detailed', 'score', { detail: true, amount: 5 }));
    expect(rate(world, input).score.value).toBe(base.score.value + 5);
  });
});

describe('the policy door (D-01)', () => {
  it('rates every promotion by the same rules without a provider', () => {
    const { world, mainEvent } = tinyRating();
    const input = inputOf(world, mainEvent.id);
    expect(ratingPolicyFor(world, DEFAULT_TUNABLES, input.promotionId)).toBe(NEUTRAL_RATING_POLICY);
    const rated = rate(world, input);
    expect(rated.policy).toEqual({
      label: 'Full rules',
      simpleInputs: false,
      skipInMatchInjuries: false,
    });
    expect(stepsLabelled(rated.score, `${DEFAULT_POLICY_LABEL} +0`)).toHaveLength(1);
    const reasons = findTraceNodes(rated.score.trace, 'constant').map((node) => node.reason);
    expect(reasons).toContain(DEFAULT_POLICY_LABEL);
  });

  it('changes nothing when a provider hands back the neutral policy', () => {
    const { world, mainEvent } = tinyRating();
    const input = inputOf(world, mainEvent.id);
    const base = rate(world, input);
    registerRatingPolicyProvider(() => NEUTRAL_RATING_POLICY);
    expect(rate(world, input)).toEqual(base);
  });

  it("raises the score by exactly the provider's score bonus", () => {
    const { world, mainEvent, promo } = tinyRating();
    for (const segment of [mainEvent, promo]) {
      resetMatchRegistriesForTests();
      const input = inputOf(world, segment.id);
      const base = rate(world, input);
      registerRatingPolicyProvider(
        () =>
          policy({
            scoreBonus: constantOf('Score bonus', 3, 'Test rival bonus'),
            lines: ['Rival bonus'],
          }),
        { id: 'test.bonus' },
      );
      const rated = rate(world, input);
      expect(rated.score.value).toBe(base.score.value + 3);
      expect(stepsLabelled(rated.score, 'Rival bonus +3')).toHaveLength(1);
      expectTraceReplays(rated.score);
    }
  });

  it('passes the promotion running the show to the provider', () => {
    const { world, mainEvent } = tinyRating();
    const seen: string[] = [];
    registerRatingPolicyProvider((_read, _tunables, promotionId) => {
      seen.push(promotionId);
      return NEUTRAL_RATING_POLICY;
    });
    const input = inputOf(world, mainEvent.id);
    rate(world, input);
    expect(seen).toEqual([input.promotionId]);
  });

  it('allows one provider: a second throws, naming the first', () => {
    registerRatingPolicyProvider(() => NEUTRAL_RATING_POLICY, { id: 'aip1.ratingPolicy' });
    expect(() =>
      registerRatingPolicyProvider(() => NEUTRAL_RATING_POLICY, { id: 'test.second' }),
    ).toThrow(/"aip1\.ratingPolicy" is already registered/);
  });

  it('frees the door when the provider is removed', () => {
    const unregister = registerRatingPolicyProvider(() => NEUTRAL_RATING_POLICY);
    unregister();
    expect(() => registerRatingPolicyProvider(() => NEUTRAL_RATING_POLICY)).not.toThrow();
  });
});

describe('the rater registry', () => {
  it('refuses to replace a kind without { replace: true }', () => {
    expect(() =>
      registerSegmentRater('angle', () => {
        throw new Error('not used');
      }),
    ).toThrow(/replace: true/);
  });

  it('swaps a rater explicitly and restores the old one when undone', () => {
    const { world, promo } = tinyRating();
    const input = inputOf(world, promo.id);
    const base = rate(world, input);
    const builtIn = segmentRaterFor('angle');
    const undo = registerSegmentRater(
      'angle',
      (ctx) => {
        if (builtIn === undefined) {
          throw new Error('no built-in angle rater');
        }
        const result = builtIn(ctx);
        return { ...result, policy: { ...result.policy, label: 'Beat-based' } };
      },
      { replace: true },
    );
    expect(rate(world, input).policy.label).toBe('Beat-based');
    undo();
    expect(rate(world, input)).toEqual(base);
  });
});
