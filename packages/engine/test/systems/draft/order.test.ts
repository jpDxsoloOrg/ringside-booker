// The draft's pick order (DRF-01): snake, random and by size.
// Design: docs/design/draft.md#pick-order
import { describe, expect, it } from 'vitest';
import type { PromotionId } from '../../../src/core/ids';
import { testId } from '../../support/ids';
import type { DraftOrder } from '../../../src/model/entities/draft';
import { nextTurn, roundOrder, seededOrder } from '../../../src/systems/draft/order';

const ids: PromotionId[] = [1, 2, 3, 4].map((serial) => testId('promotion', serial));

function draft(order: DraftOrder) {
  return {
    id: testId('draft'),
    order: ids,
    settings: {
      order,
      rosterTarget: 2,
      staffTarget: 0,
      draftStaff: false,
      negotiateAfter: false,
      schedule: 'weekly' as const,
    },
  };
}

describe('roundOrder', () => {
  it('snakes: every other round runs backwards', () => {
    const snake = draft('snake');
    expect(roundOrder(snake, 0, 'seed')).toEqual(ids);
    expect(roundOrder(snake, 1, 'seed')).toEqual([...ids].reverse());
    expect(roundOrder(snake, 2, 'seed')).toEqual(ids);
  });

  it('by size keeps round one every round', () => {
    expect(roundOrder(draft('bySize'), 3, 'seed')).toEqual(ids);
  });

  it('random reshuffles each round, the same way every time', () => {
    const random = draft('random');
    const rounds = [1, 2, 3, 4, 5].map((round) => roundOrder(random, round, 'seed'));
    expect(rounds.map((order) => [...order].sort())).toEqual(rounds.map(() => [...ids].sort()));
    expect(new Set(rounds.map((order) => order.join())).size).toBeGreaterThan(1);
    expect([1, 2, 3, 4, 5].map((round) => roundOrder(random, round, 'seed'))).toEqual(rounds);
  });

  it('round one is a seeded shuffle', () => {
    expect(seededOrder('seed', 'k', ids)).toEqual(seededOrder('seed', 'k', ids));
    expect([...seededOrder('seed', 'k', ids)].sort()).toEqual(ids);
  });
});

describe('nextTurn', () => {
  it('skips promotions that need nobody and ends when nobody needs anyone', () => {
    const snake = draft('snake');
    const full = new Set<string>([ids[1] ?? '']);
    const turns: string[] = [];
    let turn = 0;
    for (let index = 0; index < 6; index += 1) {
      const next = nextTurn(snake, turn, 'seed', (id) => !full.has(id));
      if (next === null) break;
      turns.push(next.promotionId);
      turn = next.turn + 1;
    }
    expect(turns).toEqual([ids[0], ids[2], ids[3], ids[3], ids[2], ids[0]]);
    expect(nextTurn(snake, 0, 'seed', () => false)).toBeNull();
  });
});
