// The rival desk's rating policy (AIP1-07): MTCH1's policy door answered from the Rival rules.
// Design: docs/design/rival-desk.md#shortcuts, docs/design/match-rating.md#the-policy-door-d-01
import { describe, expect, it } from 'vitest';
import { RegistryError } from '../../../src/core/errors';
import type { PromotionId } from '../../../src/core/ids';
import type { Controller } from '../../../src/model/controller';
import type { GameWorld } from '../../../src/model/tables';
import {
  aiShortcutConsumers,
  FULL_RULES_POLICY_LABEL,
  NO_RIVAL_BONUS_LINE,
  RIVAL_POLICY_LABEL,
  RIVAL_RATING_POLICY_ID,
  rivalShortcutLine,
} from '../../../src/systems/aip';
import {
  DEFAULT_POLICY_LABEL,
  NEUTRAL_RATING_POLICY,
  ratingPolicyFor,
  registerRatingPolicyProvider,
} from '../../../src/systems/match';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectTraceReplays } from '../../support/trace';
import {
  addsLabelled,
  DEFAULT_TUNABLES,
  inputOf,
  rate,
  tinyRating,
} from '../match/rating/fixtures';

const COMPUTER: Controller = { kind: 'computer' };

function setController(world: GameWorld, promotionId: PromotionId, controller: Controller): void {
  const result = world.transact('hand the promotion over', (tx) => {
    tx.update('promotions', promotionId, { controller });
  });
  if (!result.ok) throw result.error;
}

function setLevelPlayingField(world: GameWorld, levelPlayingField: boolean): void {
  const result = world.transact('level playing field', (tx) => {
    tx.setMeta({ settings: { ...world.meta.settings, levelPlayingField } });
  });
  if (!result.ok) throw result.error;
}

describe('the rival rating policy', () => {
  it('is the one registered provider: a second registration throws, naming it', () => {
    expect(() => registerRatingPolicyProvider(() => NEUTRAL_RATING_POLICY)).toThrow(RegistryError);
    expect(() => registerRatingPolicyProvider(() => NEUTRAL_RATING_POLICY)).toThrow(
      RIVAL_RATING_POLICY_ID,
    );
  });

  it('gives a rival +3 as a "Rival shortcut" line in the score trace', () => {
    const { world, mainEvent } = tinyRating();
    const input = inputOf(world, mainEvent.id);
    const asPlayer = rate(world, input);
    setController(world, input.promotionId, COMPUTER);
    const asRival = rate(world, input);

    expect(asRival.score.value).toBe(asPlayer.score.value + 3);
    expect(addsLabelled(asRival.score, 'Rival shortcut')).toHaveLength(1);
    expect(addsLabelled(asRival.score, `${rivalShortcutLine('Score bonus')} +3`)).toHaveLength(1);
    expect(asRival.policy).toEqual({
      label: RIVAL_POLICY_LABEL,
      simpleInputs: true,
      skipInMatchInjuries: true,
    });
    expect(ratingPolicyFor(world, DEFAULT_TUNABLES, input.promotionId).lines).toEqual([
      'Rival shortcut: Score bonus',
      'Rival shortcut: Simpler booking',
      'Rival shortcut: No in-match injuries',
    ]);
    expectTraceReplays(asRival.score);
  });

  it("gives the player's promotion 0 and the full rules", () => {
    const { world, mainEvent } = tinyRating();
    const input = inputOf(world, mainEvent.id);
    const rated = rate(world, input);
    expect(addsLabelled(rated.score, 'Rival shortcut')).toHaveLength(0);
    expect(addsLabelled(rated.score, `${DEFAULT_POLICY_LABEL} +0`)).toHaveLength(1);
    expect(rated.policy).toEqual({
      label: FULL_RULES_POLICY_LABEL,
      simpleInputs: false,
      skipInMatchInjuries: false,
    });
  });

  it('gives a rival 0 and the full rules under the level playing field', () => {
    const { world, mainEvent } = tinyRating();
    const input = inputOf(world, mainEvent.id);
    const asPlayer = rate(world, input);
    setController(world, input.promotionId, COMPUTER);
    setLevelPlayingField(world, true);
    const rated = rate(world, input);
    expect(rated.score.value).toBe(asPlayer.score.value);
    expect(addsLabelled(rated.score, 'Rival shortcut')).toHaveLength(0);
    expect(rated.policy.label).toBe(FULL_RULES_POLICY_LABEL);
  });

  it('keeps the other shortcuts when only the bonus is turned off', () => {
    const { world, mainEvent } = tinyRating();
    const input = inputOf(world, mainEvent.id);
    setController(world, input.promotionId, COMPUTER);
    const tunables = createEngineTunables({ 'ai.scoreBonus': 0 });
    const policy = ratingPolicyFor(world, tunables, input.promotionId);
    expect(policy.scoreBonus.value).toBe(0);
    expect(policy.label).toBe(RIVAL_POLICY_LABEL);
    expect(policy.lines[0]).toBe(NO_RIVAL_BONUS_LINE);
  });

  it('registers MTCH1 as the consumer of the score bonus and simpler booking only', () => {
    const consumer = { featureId: 'MTCH1', label: 'Match ratings' };
    expect(aiShortcutConsumers('ai.scoreBonus')).toEqual([{ key: 'ai.scoreBonus', ...consumer }]);
    expect(aiShortcutConsumers('ai.simpleBookingInputs')).toEqual([
      { key: 'ai.simpleBookingInputs', ...consumer },
    ]);
    expect(aiShortcutConsumers('ai.skipInMatchInjuries')).toEqual([]);
  });
});
