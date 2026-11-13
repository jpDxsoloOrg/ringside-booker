// What a viewer sees of a promotion's private numbers (AIP1-02).
// Design: docs/design/rival-desk.md#visibility
import { describe, expect, it } from 'vitest';
import { OMNISCIENT_VIEWER, type Viewer } from '../../../src/core/api';
import type { PromotionId } from '../../../src/core/ids';
import {
  CASH_DISPLAY_BANDS,
  CASH_DISPLAY_BANDS_REASON,
  canSeePrivate,
  privateInputOf,
  redactForViewer,
  visibilityOf,
} from '../../../src/systems/aip';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { expectSerialisable, expectTraceContains } from '../../support/trace';
import { worldBuilder, type BuiltWorld } from '../../support/world-builder';

const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const PLAYER: Viewer = { kind: 'controller', controller: HUMAN };
const COMPUTER_VIEWER: Viewer = { kind: 'controller', controller: { kind: 'computer' } };

function twoPromotions(sandbox = false): BuiltWorld {
  return worldBuilder({ settings: { sandbox } })
    .withGeography('mini')
    .withPromotion({ controller: HUMAN })
    .withPromotion({ controller: { kind: 'computer' } })
    .build();
}

function promotion(built: BuiltWorld, label: 'A' | 'B'): PromotionId {
  const id = built.ids.promotions[label];
  if (id === undefined) {
    throw new Error(`no promotion ${label}`);
  }
  return id;
}

/** $300,000 in cents: in the "Comfortable" band. */
const RIVAL_CASH = 30_000_000;

describe('visibilityOf', () => {
  it('is own for the promotion the viewer runs and public for a rival', () => {
    const built = twoPromotions();
    expect(visibilityOf(built.world, PLAYER, promotion(built, 'A'))).toBe('own');
    expect(visibilityOf(built.world, PLAYER, promotion(built, 'B'))).toBe('public');
    expect(visibilityOf(built.world, COMPUTER_VIEWER, promotion(built, 'B'))).toBe('public');
  });

  it('is sandbox under the sandbox setting and omniscient for the all-seeing viewer', () => {
    const sandbox = twoPromotions(true);
    expect(visibilityOf(sandbox.world, PLAYER, promotion(sandbox, 'B'))).toBe('sandbox');
    expect(visibilityOf(sandbox.world, PLAYER, promotion(sandbox, 'A'))).toBe('own');
    const built = twoPromotions();
    expect(visibilityOf(built.world, OMNISCIENT_VIEWER, promotion(built, 'B'))).toBe('omniscient');
  });

  it('lets every visibility but public see private figures', () => {
    expect(canSeePrivate('own')).toBe(true);
    expect(canSeePrivate('sandbox')).toBe(true);
    expect(canSeePrivate('omniscient')).toBe(true);
    expect(canSeePrivate('public')).toBe(false);
  });
});

describe('redactForViewer', () => {
  it('shows a public viewer only the cash band', () => {
    expect(redactForViewer('public', RIVAL_CASH, CASH_DISPLAY_BANDS)).toEqual({
      kind: 'band',
      label: 'Comfortable',
    });
    expect(redactForViewer('public', -5_000_00, CASH_DISPLAY_BANDS)).toEqual({
      kind: 'band',
      label: 'Struggling',
    });
    expect(redactForViewer('public', 900_000_000, CASH_DISPLAY_BANDS)).toEqual({
      kind: 'band',
      label: 'Very wealthy',
    });
  });

  it('shows the exact figure to own, sandbox and omniscient viewers', () => {
    for (const visibility of ['own', 'sandbox', 'omniscient'] as const) {
      expect(redactForViewer(visibility, RIVAL_CASH, CASH_DISPLAY_BANDS)).toEqual({
        kind: 'exact',
        value: RIVAL_CASH,
      });
    }
  });

  it('hides the figure from a public viewer when there are no bands', () => {
    expect(redactForViewer('public', RIVAL_CASH, [])).toEqual({ kind: 'hidden' });
  });

  it('never gives a public viewer an exact value', () => {
    for (const value of [Number.MIN_SAFE_INTEGER, -1, 0, 1, RIVAL_CASH, Number.MAX_SAFE_INTEGER]) {
      expect(redactForViewer('public', value, CASH_DISPLAY_BANDS).kind).not.toBe('exact');
      expect(redactForViewer('public', value, []).kind).not.toBe('exact');
    }
  });
});

describe('privateInputOf', () => {
  it('records the band label for a public viewer, with the band edge as a fixed constant', () => {
    const input = privateInputOf('Cash', RIVAL_CASH, 'public', CASH_DISPLAY_BANDS);
    expect(input.value).toBe('Comfortable');
    expect(input.trace).toMatchObject({ kind: 'input', label: 'Cash', value: 'Comfortable' });
    expect(expectTraceContains(input, { kind: 'constant' }).reason).toBe(CASH_DISPLAY_BANDS_REASON);
    expect(JSON.stringify(input)).not.toContain(String(RIVAL_CASH));
    expectSerialisable(input);
  });

  it('records the figure for a viewer who may see it, and "Hidden" without bands', () => {
    expect(privateInputOf('Cash', RIVAL_CASH, 'own', CASH_DISPLAY_BANDS)).toEqual({
      value: RIVAL_CASH,
      trace: { kind: 'input', label: 'Cash', value: RIVAL_CASH },
    });
    expect(privateInputOf('Cash', RIVAL_CASH, 'public', []).value).toBe('Hidden');
  });
});
