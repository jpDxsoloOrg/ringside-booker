import { afterEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { PromotionProfile } from '@ringside/engine';
import { galleryRivalProfile } from '@/screens/dev-gallery/fixtures/rivalDesk';
import { BUILTIN_PROMOTION_TABS } from './builtinTabs';
import {
  BUILTIN_PROMOTION_TAB_IDS,
  registeredPromotionTabs,
  registerPromotionTab,
  visiblePromotionTabs,
} from './promotionTabs';
import type { PromotionTabContext, PromotionTabDefinition } from './promotionTabs';

function tab(id: string, order: number): PromotionTabDefinition {
  return { id, label: id, order, render: () => null };
}

function context(
  isOwn: boolean,
  brandsRunBy: readonly ('you' | 'computer')[],
): PromotionTabContext {
  const profile: PromotionProfile = {
    ...galleryRivalProfile,
    header: {
      ...galleryRivalProfile.header,
      controlledBy: isOwn ? 'you' : 'computer',
      brands: brandsRunBy.map((controlledBy, index) => ({
        brandId: parseId('brand', `brd_000000000${String(index + 1)}`),
        name: `Brand ${String(index + 1)}`,
        controlledBy,
      })),
    },
  };
  return {
    profile,
    promotionId: parseId('promotion', 'pro_0000000001'),
    isOwn,
    viewerPromotionId: null,
  };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const unregister of cleanups.splice(0)) unregister();
});

describe('registerPromotionTab', () => {
  it('adds a tab and the returned function removes it again', () => {
    const shows = tab('shows', 40);
    const unregister = registerPromotionTab(shows);
    expect(registeredPromotionTabs()).toEqual([shows]);
    unregister();
    unregister();
    expect(registeredPromotionTabs()).toEqual([]);
  });

  it.each([...BUILTIN_PROMOTION_TAB_IDS, 'shows'])('throws for a taken id: %s', (id) => {
    cleanups.push(registerPromotionTab(tab('shows', 40)));
    expect(() => registerPromotionTab(tab(id, 50))).toThrow('already registered');
  });
});

describe('visiblePromotionTabs', () => {
  it('orders built-in and registered tabs by order', () => {
    const tabs = visiblePromotionTabs(
      [...BUILTIN_PROMOTION_TABS, tab('money', 100), tab('front-office', 30)],
      context(false, []),
    );
    expect(tabs.map((entry) => entry.id)).toEqual([
      'overview',
      'roster',
      'front-office',
      'decision-log',
      'money',
    ]);
  });

  it('hides the decision log on your own promotion unless the computer runs a brand', () => {
    const ids = (ctx: PromotionTabContext) =>
      visiblePromotionTabs(BUILTIN_PROMOTION_TABS, ctx).map((entry) => entry.id);
    expect(ids(context(true, ['you']))).toEqual(['overview', 'roster']);
    expect(ids(context(true, ['you', 'computer']))).toContain('decision-log');
    expect(ids(context(false, []))).toContain('decision-log');
  });
});
