import { describe, expect, it } from 'vitest';
import { initialEngineState, viewerPromotionIds } from '@ringside/engine';
import type { EngineState } from '@ringside/engine';
import { TEST_PLAYER_ID, tinyWorld, worldBuilder } from '@ringside/engine/testing';
import type { BuiltWorld } from '@ringside/engine/testing';
import { LOCAL_OBSERVER_PLAYER_ID, resolveLocalViewer } from './localViewer';
import type { LocalSeat } from './localViewer';

const SECOND_PLAYER_ID = 'player-2';

function stateOf(built: BuiltWorld): EngineState {
  return initialEngineState(built.world);
}

/** The first promotion the engine says the seat's viewer runs, or null when it runs none. */
function enginePromotionFor(built: BuiltWorld, seat: LocalSeat): string | null {
  return viewerPromotionIds(built.world, seat.viewer)[0] ?? null;
}

function expectViewerMatchesController(seat: LocalSeat): void {
  expect(seat.viewer).toEqual({ kind: 'controller', controller: seat.controller });
}

describe('resolveLocalViewer', () => {
  it('plays the human who runs the one human promotion', () => {
    const built = tinyWorld();
    const { seat, warnings } = resolveLocalViewer(stateOf(built));

    expect(seat.controller).toEqual({ kind: 'human', playerId: TEST_PLAYER_ID });
    expect(seat.promotionId).toBe(built.ids.promotions.A);
    expect(seat.promotionId).toBe(enginePromotionFor(built, seat));
    expectViewerMatchesController(seat);
    expect(warnings).toEqual([]);
  });

  it('plays the human who controls a brand under a computer-run promotion', () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withPromotion({ name: 'Computer Promotion' })
      .withPromotion({ name: 'Brand Owner' }, (promotion) =>
        promotion.withBrand({ name: 'Computer Brand' }).withBrand({
          name: 'Human Brand',
          controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        }),
      )
      .build();
    const { seat, warnings } = resolveLocalViewer(stateOf(built));

    expect(seat.controller).toEqual({ kind: 'human', playerId: TEST_PLAYER_ID });
    expect(seat.promotionId).toBe(built.ids.promotions.B);
    expectViewerMatchesController(seat);
    expect(warnings).toEqual([]);
    // The engine's viewerPromotionIds only reads promotion controllers, so it lists no promotion
    // for a brand-only human; the seat still names the promotion that owns the brand.
    expect(enginePromotionFor(built, seat)).toBeNull();
  });

  it('plays an observer with no promotion when no human controls anything', () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withPromotion({ name: 'Computer Promotion' }, (promotion) => promotion.withBrand())
      .build();
    const { seat, warnings } = resolveLocalViewer(stateOf(built));

    expect(seat.controller).toEqual({ kind: 'human', playerId: LOCAL_OBSERVER_PLAYER_ID });
    expect(seat.promotionId).toBeNull();
    expect(seat.promotionId).toBe(enginePromotionFor(built, seat));
    expectViewerMatchesController(seat);
    expect(warnings).toEqual([]);
  });

  it('picks the lowest player id, with a warning, when several humans play', () => {
    const built = worldBuilder({
      players: [
        { playerId: SECOND_PLAYER_ID, displayName: 'Second Player' },
        { playerId: TEST_PLAYER_ID, displayName: 'First Player' },
      ],
    })
      .withGeography('mini')
      .withPromotion({
        name: 'Second Promotion',
        controller: { kind: 'human', playerId: SECOND_PLAYER_ID },
      })
      .withPromotion({
        name: 'First Promotion',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
      })
      .build();
    const { seat, warnings } = resolveLocalViewer(stateOf(built));

    expect(seat.controller).toEqual({ kind: 'human', playerId: TEST_PLAYER_ID });
    expect(seat.promotionId).toBe(built.ids.promotions.B);
    expect(seat.promotionId).toBe(enginePromotionFor(built, seat));
    expectViewerMatchesController(seat);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(SECOND_PLAYER_ID);
    expect(warnings[0]).toContain(`Playing as "${TEST_PLAYER_ID}"`);
  });

  it('takes the lowest promotion id when one human runs several promotions', () => {
    const human = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
    const built = worldBuilder()
      .withGeography('mini')
      .withPromotion({ name: 'Flagship', controller: human })
      .withPromotion({ name: 'Territory', controller: human })
      .build();
    const { seat } = resolveLocalViewer(stateOf(built));

    expect(seat.promotionId).toBe(enginePromotionFor(built, seat));
    expect(seat.promotionId).toBe(built.ids.promotions.A);
  });
});
