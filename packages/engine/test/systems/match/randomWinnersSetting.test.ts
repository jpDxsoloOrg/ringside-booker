// The Random winners new-game setting and randomWinnersActive (MTCH2-03).
// Design: docs/design/match-finishes.md#random-winners
import { describe, expect, it } from 'vitest';
import type { BrandId, PromotionId } from '../../../src/core/ids';
import type { GameWorld } from '../../../src/model/tables';
import { RANDOM_WINNERS_SETTING, randomWinnersActive } from '../../../src/systems/match';
import { createNewGame, getSetting } from '../../../src/systems/newgame';
import { newGameSettings, settingReasons } from '../../../src/systems/newgame/settings';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { miniWorldPacks } from '../../support/fixture-packs';
import { worldBuilder } from '../../support/world-builder';
import { tinyWorld } from '../../support/worlds';

/**
 * Promotion A is human-run with one brand; promotion B is computer-run with a human-run brand
 * (brand wars) and a computer-run one.
 */
function settingWorld(randomWinners: boolean | undefined): {
  world: GameWorld;
  humanPromotion: PromotionId;
  humanBrand: BrandId;
  rivalPromotion: PromotionId;
  rivalHumanBrand: BrandId;
  rivalBrand: BrandId;
} {
  const { world, ids } = worldBuilder(
    randomWinners === undefined ? {} : { settings: { extra: { randomWinners } } },
  )
    .withGeography('mini')
    .withPromotion(
      { name: 'Human Promotion', controller: { kind: 'human', playerId: TEST_PLAYER_ID } },
      (promotion) => promotion.withBrand({ name: 'Human Brand' }).withRoster(2),
    )
    .withPromotion({ name: 'Rival Promotion', controller: { kind: 'computer' } }, (promotion) =>
      promotion
        .withBrand({
          name: 'Rival Human Brand',
          controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        })
        .withBrand({ name: 'Rival Brand', controller: { kind: 'computer' } })
        .withRoster(2),
    )
    .build();
  const { A: humanPromotion, B: rivalPromotion } = ids.promotions;
  const [humanBrand, rivalHumanBrand, rivalBrand] = ids.brands;
  if (
    humanPromotion === undefined ||
    rivalPromotion === undefined ||
    humanBrand === undefined ||
    rivalHumanBrand === undefined ||
    rivalBrand === undefined
  ) {
    throw new Error('settingWorld needs two promotions and three brands');
  }
  return { world, humanPromotion, humanBrand, rivalPromotion, rivalHumanBrand, rivalBrand };
}

describe('the randomWinners setting', () => {
  it('is registered once, under Difficulty, off by default', () => {
    const matching = newGameSettings().filter((def) => def.key === 'randomWinners');
    expect(matching).toEqual([{ ...RANDOM_WINNERS_SETTING }]);
    expect(matching[0]).toMatchObject({
      kind: 'boolean',
      default: false,
      label: 'Random winners',
      group: 'difficulty',
    });
  });

  it('refuses a value that is not true or false', () => {
    expect(settingReasons({ randomWinners: 'yes' })).toEqual([
      expect.objectContaining({ code: 'invalidSetting', field: 'settings.randomWinners' }),
    ]);
    expect(settingReasons({ randomWinners: true })).toEqual([]);
  });

  it('reads false in a world from before the setting existed', () => {
    const { world } = tinyWorld();
    expect(world.meta.settings.extra['randomWinners']).toBeUndefined();
    expect(getSetting(world, 'randomWinners')).toBe(false);
  });

  it('is stored in settings.extra by createNewGame', () => {
    const result = createNewGame(miniWorldPacks(), {
      rootPackId: 'mini-world',
      seed: 'random-winners-test',
      playerId: 'local-player',
      playerName: 'Alex Booker',
      saveName: 'Harbour Run',
      seasonLength: { preset: '12m' },
      player: { mode: 'existing', promotionKey: 'harbour-city-wrestling' },
      settings: { randomWinners: true },
    });
    if (!result.ok) {
      expect.fail(`New game was refused: ${JSON.stringify(result.reasons)}`);
    }
    expect(result.state.world.meta.settings.extra['randomWinners']).toBe(true);
    expect(getSetting(result.state.world, 'randomWinners')).toBe(true);
  });
});

describe('randomWinnersActive', () => {
  it('is true for a human-run promotion when the setting is on', () => {
    const { world, humanPromotion, humanBrand } = settingWorld(true);
    expect(randomWinnersActive(world, { promotionId: humanPromotion, brandId: null })).toBe(true);
    expect(randomWinnersActive(world, { promotionId: humanPromotion, brandId: humanBrand })).toBe(
      true,
    );
  });

  it('follows the brand controller: a human-run brand of a computer promotion counts', () => {
    const { world, rivalPromotion, rivalHumanBrand, rivalBrand } = settingWorld(true);
    expect(
      randomWinnersActive(world, { promotionId: rivalPromotion, brandId: rivalHumanBrand }),
    ).toBe(true);
    expect(randomWinnersActive(world, { promotionId: rivalPromotion, brandId: rivalBrand })).toBe(
      false,
    );
    expect(randomWinnersActive(world, { promotionId: rivalPromotion, brandId: null })).toBe(false);
  });

  it('is false everywhere when the setting is off or missing', () => {
    for (const setting of [false, undefined]) {
      const { world, humanPromotion, rivalPromotion, rivalHumanBrand } = settingWorld(setting);
      expect(randomWinnersActive(world, { promotionId: humanPromotion, brandId: null })).toBe(
        false,
      );
      expect(
        randomWinnersActive(world, { promotionId: rivalPromotion, brandId: rivalHumanBrand }),
      ).toBe(false);
    }
  });
});
