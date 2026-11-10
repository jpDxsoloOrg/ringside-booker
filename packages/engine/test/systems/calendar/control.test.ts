// Who controls a show. Design: docs/design/calendar.md#who-controls-a-show
import { describe, expect, it } from 'vitest';
import { controllerViewer, OMNISCIENT_VIEWER } from '../../../src/core/api';
import { testId } from '../../support';
import {
  controlsShow,
  sameController,
  showControllerOf,
  viewerControlsShow,
} from '../../../src/systems/calendar';
import { COMPUTER, lifecycleWorld, PLAYER_ONE, PLAYER_THREE, PLAYER_TWO } from './lifecycle-world';

describe('showControllerOf', () => {
  it("prefers the brand's controller when the brand has one", () => {
    const { world, promotionA, rivalBrand } = lifecycleWorld();
    expect(showControllerOf(world, { promotionId: promotionA, brandId: rivalBrand })).toEqual(
      PLAYER_TWO,
    );
  });

  it("falls back to the promotion's controller for a brand without one", () => {
    const { world, promotionA, sharedBrand } = lifecycleWorld();
    expect(showControllerOf(world, { promotionId: promotionA, brandId: sharedBrand })).toEqual(
      PLAYER_ONE,
    );
  });

  it("uses the promotion's controller for a promotion-wide show", () => {
    const { world, promotionA, promotionB } = lifecycleWorld();
    expect(showControllerOf(world, { promotionId: promotionA, brandId: null })).toEqual(PLAYER_ONE);
    expect(showControllerOf(world, { promotionId: promotionB, brandId: null })).toEqual(COMPUTER);
  });

  it('throws for a show whose promotion is not in the world', () => {
    const { world } = lifecycleWorld();
    expect(() =>
      showControllerOf(world, { promotionId: testId('promotion', 99), brandId: null }),
    ).toThrow(/No promotions with ID/);
  });
});

describe('sameController', () => {
  it('is true for the same human and for two computers', () => {
    expect(sameController(PLAYER_ONE, { kind: 'human', playerId: 'player-1' })).toBe(true);
    expect(sameController(COMPUTER, { kind: 'computer' })).toBe(true);
  });

  it('is false for two different players', () => {
    expect(sameController(PLAYER_ONE, PLAYER_TWO)).toBe(false);
  });

  it('is false for a human and the computer, either way round', () => {
    expect(sameController(PLAYER_ONE, COMPUTER)).toBe(false);
    expect(sameController(COMPUTER, PLAYER_ONE)).toBe(false);
  });
});

describe('controlsShow', () => {
  it('gives a brand-run show to the brand controller and not to the promotion controller', () => {
    const { world, promotionA, rivalBrand } = lifecycleWorld();
    const show = { promotionId: promotionA, brandId: rivalBrand };
    expect(controlsShow(world, show, PLAYER_TWO)).toBe(true);
    expect(controlsShow(world, show, PLAYER_ONE)).toBe(false);
    expect(controlsShow(world, show, COMPUTER)).toBe(false);
  });

  it("gives a computer promotion's show to the computer only", () => {
    const { world, promotionB } = lifecycleWorld();
    const show = { promotionId: promotionB, brandId: null };
    expect(controlsShow(world, show, COMPUTER)).toBe(true);
    expect(controlsShow(world, show, PLAYER_ONE)).toBe(false);
  });
});

describe('viewerControlsShow', () => {
  it('is false for the omniscient viewer, whoever runs the show', () => {
    const { world, promotionA, promotionB, rivalBrand } = lifecycleWorld();
    expect(
      viewerControlsShow(world, { promotionId: promotionA, brandId: null }, OMNISCIENT_VIEWER),
    ).toBe(false);
    expect(
      viewerControlsShow(
        world,
        { promotionId: promotionA, brandId: rivalBrand },
        OMNISCIENT_VIEWER,
      ),
    ).toBe(false);
    expect(
      viewerControlsShow(world, { promotionId: promotionB, brandId: null }, OMNISCIENT_VIEWER),
    ).toBe(false);
  });

  it('follows the controller for a controller viewer', () => {
    const { world, promotionA, rivalBrand } = lifecycleWorld();
    const show = { promotionId: promotionA, brandId: rivalBrand };
    expect(viewerControlsShow(world, show, controllerViewer(PLAYER_TWO))).toBe(true);
    expect(viewerControlsShow(world, show, controllerViewer(PLAYER_ONE))).toBe(false);
    expect(viewerControlsShow(world, show, controllerViewer(PLAYER_THREE))).toBe(false);
  });
});
