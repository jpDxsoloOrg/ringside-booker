import { describe, expect, it } from 'vitest';
import { mobilePrimaryItems, navigationSections, visibleNavigation } from '../navigation';
import { countBehindMore } from './useNavBadges';

describe('countBehindMore', () => {
  it('adds up the badges of items that only the More sheet lists', () => {
    const sections = visibleNavigation(navigationSections, { hasPromotion: true });
    const primaries = mobilePrimaryItems(sections);

    // Inbox sits behind More; Dashboard (pending decisions) is a tab with its own badge.
    expect(
      countBehindMore(sections, primaries, { unreadMail: 3, pendingDecisions: 2, wantsToLeave: 0 }),
    ).toBe(3);
  });

  it('is 0 when every badged item has a tab', () => {
    const sections = visibleNavigation(navigationSections, { hasPromotion: false });
    const primaries = mobilePrimaryItems(sections);

    // Unemployed, Inbox falls back into the tab bar.
    expect(primaries.map((item) => item.id)).toContain('inbox');
    expect(
      countBehindMore(sections, primaries, { unreadMail: 5, pendingDecisions: 1, wantsToLeave: 0 }),
    ).toBe(0);
  });
});
