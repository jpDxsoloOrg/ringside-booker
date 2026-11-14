import { matchPath } from 'react-router-dom';
import type { ComponentType } from 'react';
import type { IconName } from '@/components/Icon';
import { BookingScreen } from '@/screens/booking';
import { CalendarScreen } from '@/screens/calendar/CalendarScreen';
import { ContractsScreen } from '@/screens/contracts/ContractsScreen';
import { FinancesScreen } from '@/screens/finances/FinancesScreen';
import { MatchLabScreen } from '@/screens/match-lab/MatchLabScreen';
import { OfficeScreen } from '@/screens/office/OfficeScreen';
import { ProductionScreen } from '@/screens/production/ProductionScreen';
import { RosterScreen } from '@/screens/roster/RosterScreen';
import { TitlesScreen } from '@/screens/titles/TitlesScreen';
import { PromotionsScreen } from '@/screens/promotions/PromotionsScreen';
import { WorkersScreen } from '@/screens/workers/WorkersScreen';
import { routes } from './routes';

/**
 * The in-game navigation, declared as data.
 *
 * The sidebar, the phone bottom bar, the More sheet, the top bar title and the router all read
 * this list, so a feature epic adds a screen by adding one item here (plus its path in
 * `routes.ts` and the screen component). Nothing in the shell changes.
 *
 * Ids are stable; labels and grouping are a first pass and will move as screens land.
 */

/** A slot in the phone bottom bar, left to right. The fifth place is always "More". */
export type MobileSlot = 1 | 2 | 3 | 4;

/** Counts a nav item can show in a badge. `useNavBadges` supplies them. */
export type NavBadgeKey = 'unreadMail' | 'pendingDecisions' | 'wantsToLeave';

interface NavItemBase {
  /** Stable id, unique across every section. */
  readonly id: string;
  /** Text in the sidebar and the More sheet, and the screen's `h1`. */
  readonly label: string;
  /** A shorter label for the phone bottom bar, where space is tight. */
  readonly shortLabel?: string;
  readonly icon: IconName;
  /** The item's URL, from a `routes` builder. */
  readonly to: string;
  /** Where the item sits in the phone bottom bar, if it is one of the primaries. */
  readonly mobilePrimary?: MobileSlot;
  /**
   * The slot this item fills when the item that normally holds it is hidden, for example when
   * the player runs no promotion and Roster disappears.
   */
  readonly mobileFallback?: MobileSlot;
  readonly badgeKey?: NavBadgeKey;
}

/** A screen that is not built yet: the router shows `PlaceholderScreen` with the item's label. */
export interface PlaceholderNavItem extends NavItemBase {
  readonly status: 'placeholder';
}

/** A built screen: the router renders `screen` at the item's path. */
export interface LiveNavItem extends NavItemBase {
  readonly status: 'live';
  readonly screen: ComponentType;
}

export type NavItem = PlaceholderNavItem | LiveNavItem;

export interface NavSection {
  readonly id: string;
  readonly label: string;
  /** Hidden while the local viewer runs no promotion (unemployed). */
  readonly requiresPromotion: boolean;
  readonly items: readonly NavItem[];
}

export const navigationSections: readonly NavSection[] = [
  {
    id: 'office',
    label: 'Office',
    requiresPromotion: false,
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        shortLabel: 'Office',
        icon: 'office',
        to: routes.game.office(),
        mobilePrimary: 1,
        badgeKey: 'pendingDecisions',
        status: 'live',
        screen: OfficeScreen,
      },
      {
        id: 'inbox',
        label: 'Inbox',
        icon: 'inbox',
        to: routes.game.inbox(),
        mobileFallback: 3,
        badgeKey: 'unreadMail',
        status: 'placeholder',
      },
      {
        id: 'news',
        label: 'News',
        icon: 'newspaper',
        to: routes.game.news(),
        mobileFallback: 4,
        status: 'placeholder',
      },
    ],
  },
  {
    id: 'world',
    label: 'World',
    requiresPromotion: false,
    items: [
      {
        id: 'workers',
        label: 'Workers',
        icon: 'user-search',
        to: routes.game.workers(),
        mobileFallback: 2,
        status: 'live',
        screen: WorkersScreen,
      },
      {
        id: 'promotions',
        label: 'Promotions',
        icon: 'building',
        to: routes.game.promotions(),
        status: 'live',
        screen: PromotionsScreen,
      },
      {
        id: 'event-history',
        label: 'Event history',
        icon: 'history',
        to: routes.game.eventHistory(),
        status: 'placeholder',
      },
    ],
  },
  {
    id: 'your-promotion',
    label: 'Your promotion',
    requiresPromotion: true,
    items: [
      {
        id: 'roster',
        label: 'Roster',
        icon: 'roster',
        to: routes.game.roster(),
        mobilePrimary: 2,
        status: 'live',
        screen: RosterScreen,
      },
      {
        id: 'booking',
        label: 'Booking',
        icon: 'booking',
        to: routes.game.booking(),
        mobilePrimary: 3,
        status: 'live',
        screen: BookingScreen,
      },
      {
        id: 'calendar',
        label: 'Calendar',
        icon: 'calendar',
        to: routes.game.calendar(),
        mobilePrimary: 4,
        status: 'live',
        screen: CalendarScreen,
      },
      {
        id: 'match-lab',
        label: 'Match lab',
        icon: 'lab',
        to: routes.game.matchLab(),
        status: 'live',
        screen: MatchLabScreen,
      },
    ],
  },
  {
    id: 'creative',
    label: 'Creative',
    requiresPromotion: true,
    items: [
      {
        id: 'titles',
        label: 'Titles',
        icon: 'titles',
        to: routes.game.titles(),
        status: 'live',
        screen: TitlesScreen,
      },
      {
        id: 'storylines',
        label: 'Storylines',
        icon: 'storylines',
        to: routes.game.storylines(),
        status: 'placeholder',
      },
      {
        id: 'teams',
        label: 'Teams & stables',
        icon: 'link',
        to: routes.game.teams(),
        status: 'placeholder',
      },
      {
        id: 'tournaments',
        label: 'Tournaments',
        icon: 'bracket',
        to: routes.game.tournaments(),
        status: 'placeholder',
      },
      {
        id: 'brands',
        label: 'Brands',
        icon: 'layers',
        to: routes.game.brands(),
        status: 'placeholder',
      },
    ],
  },
  {
    id: 'business',
    label: 'Business',
    requiresPromotion: true,
    items: [
      {
        id: 'finances',
        label: 'Finances',
        icon: 'finance',
        to: routes.game.finances(),
        status: 'live',
        screen: FinancesScreen,
      },
      {
        id: 'contracts',
        label: 'Contracts',
        icon: 'contracts',
        to: routes.game.contracts(),
        status: 'live',
        screen: ContractsScreen,
        badgeKey: 'wantsToLeave',
      },
      {
        id: 'networks',
        label: 'Networks',
        icon: 'tv',
        to: routes.game.networks(),
        status: 'placeholder',
      },
      {
        id: 'production',
        label: 'Production',
        icon: 'video',
        to: routes.game.production(),
        status: 'live',
        screen: ProductionScreen,
      },
    ],
  },
];

export interface NavigationContext {
  /** Whether the local viewer runs a promotion. */
  readonly hasPromotion: boolean;
}

/** The sections the viewer can see: promotion sections drop out while unemployed. */
export function visibleNavigation(
  sections: readonly NavSection[],
  { hasPromotion }: NavigationContext,
): readonly NavSection[] {
  return sections.filter((section) => hasPromotion || !section.requiresPromotion);
}

const MOBILE_SLOTS: readonly MobileSlot[] = [1, 2, 3, 4];

/**
 * The phone bottom bar's items in slot order, from already-filtered sections. Each slot takes the
 * visible item marked `mobilePrimary` for it, or else the visible item marked `mobileFallback`.
 * A slot with neither is left out.
 */
export function mobilePrimaryItems(visibleSections: readonly NavSection[]): readonly NavItem[] {
  const items = visibleSections.flatMap((section) => section.items);
  const primaries: NavItem[] = [];
  for (const slot of MOBILE_SLOTS) {
    const chosen =
      items.find((item) => item.mobilePrimary === slot) ??
      items.find((item) => item.mobileFallback === slot);
    if (chosen !== undefined) primaries.push(chosen);
  }
  return primaries;
}

/** Every item in every section, flattened in display order. */
export function allNavItems(sections: readonly NavSection[]): readonly NavItem[] {
  return sections.flatMap((section) => section.items);
}

export interface NavLocation {
  readonly section: NavSection;
  readonly item: NavItem;
}

/**
 * The section and item whose screen is at `pathname`, or under it (a detail page such as
 * `/game/workers/per_x` belongs to Workers). Null for a path no item owns.
 */
export function findNavLocation(
  sections: readonly NavSection[],
  pathname: string,
): NavLocation | null {
  for (const section of sections) {
    for (const item of section.items) {
      const ownsPath =
        matchPath({ path: item.to, end: true }, pathname) !== null ||
        matchPath({ path: `${item.to}/*`, end: false }, pathname) !== null;
      if (ownsPath) return { section, item };
    }
  }
  return null;
}
