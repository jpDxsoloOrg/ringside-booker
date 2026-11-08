import { parseId } from '@ringside/engine';
import { describe, expect, it } from 'vitest';
import {
  allNavItems,
  findNavLocation,
  mobilePrimaryItems,
  navigationSections,
  visibleNavigation,
} from './navigation';
import { findRouteByPath } from '@/test/routeTree';
import { appRoutes } from './router';
import { GAME_SCREEN_IDS, routes } from './routes';

const PROMOTION_SECTION_IDS = ['your-promotion', 'creative', 'business'];

function sectionIds(hasPromotion: boolean): string[] {
  return visibleNavigation(navigationSections, { hasPromotion }).map((section) => section.id);
}

function primaryIds(hasPromotion: boolean): string[] {
  return mobilePrimaryItems(visibleNavigation(navigationSections, { hasPromotion })).map(
    (item) => item.id,
  );
}

describe('visibleNavigation', () => {
  it('shows every section to a viewer who runs a promotion', () => {
    expect(sectionIds(true)).toEqual(['office', 'world', 'your-promotion', 'creative', 'business']);
  });

  it('hides the three promotion sections while unemployed', () => {
    const visible = sectionIds(false);

    expect(visible).toEqual(['office', 'world']);
    for (const sectionId of PROMOTION_SECTION_IDS) {
      expect(visible).not.toContain(sectionId);
    }
  });

  it('marks exactly the promotion sections as needing a promotion', () => {
    const needing = navigationSections
      .filter((section) => section.requiresPromotion)
      .map((section) => section.id);

    expect(needing).toEqual(PROMOTION_SECTION_IDS);
  });
});

describe('mobilePrimaryItems', () => {
  it('puts Dashboard, Roster, Booking and Calendar in the phone tab bar', () => {
    expect(primaryIds(true)).toEqual(['dashboard', 'roster', 'booking', 'calendar']);
  });

  it('falls back to World and Office screens while unemployed', () => {
    expect(primaryIds(false)).toEqual(['dashboard', 'workers', 'inbox', 'news']);
  });

  it('never repeats an item and never fills more than four slots', () => {
    for (const hasPromotion of [true, false]) {
      const ids = primaryIds(hasPromotion);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('navigation config', () => {
  it('uses unique section ids', () => {
    const ids = navigationSections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses item ids that are unique across every section', () => {
    const ids = allNavItems(navigationSections).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('links each item to a different path', () => {
    const paths = allNavItems(navigationSections).map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('gives every in-game screen route exactly one nav item', () => {
    const paths = allNavItems(navigationSections).map((item) => item.to);
    const screenPaths = GAME_SCREEN_IDS.map((screenId) => routes.game[screenId]());

    expect([...paths].sort()).toEqual([...screenPaths].sort());
  });

  it.each(allNavItems(navigationSections).map((item) => [item.id, item.to] as const))(
    '%s links to %s, which the router registers inside the shell',
    (_itemId, path) => {
      const gameRoute = findRouteByPath(appRoutes, routes.game.root());

      expect(gameRoute).toBeDefined();
      expect(findRouteByPath(gameRoute?.children ?? [], path)).toBeDefined();
    },
  );
});

describe('findNavLocation', () => {
  it('finds the section and item of a screen path', () => {
    const location = findNavLocation(navigationSections, routes.game.titles());

    expect(location?.section.id).toBe('creative');
    expect(location?.item.id).toBe('titles');
  });

  it('gives a detail page to the item it sits under', () => {
    const detailPath = routes.game.worker(parseId('person', 'per_0000000001'));

    expect(findNavLocation(navigationSections, detailPath)?.item.id).toBe('workers');
  });

  it('returns null for a path no item owns', () => {
    expect(findNavLocation(navigationSections, '/game/nowhere')).toBeNull();
  });

  it('only searches the sections it is given', () => {
    const unemployed = visibleNavigation(navigationSections, { hasPromotion: false });

    expect(findNavLocation(unemployed, routes.game.roster())).toBeNull();
  });
});
