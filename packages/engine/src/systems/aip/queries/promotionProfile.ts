/**
 * `promotions.profile`: one promotion's page: header, KPIs, the popularity drill-down, its shows,
 * its titles and the Rival rules as they apply to it.
 *
 * Public except the money, as `promotions.list`: `cash` is redacted for a viewer who does not run
 * the promotion, and `hidden` names what was left out so the screen can say so. Popularity carries
 * its Why? inline. `showsPerMonth` counts the promotion's dated shows (EVT1's `eventInstances`, not
 * cancelled) in the next 28 days, one-offs included; a day past the calendar's scheduling horizon
 * falls back to the definitions' recurrence (AIP1-07). Design:
 * docs/design/rival-desk.md#promotions-queries.
 */

import { z } from 'zod';
import type { Viewer } from '../../../core/api/controller';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { addDays, isAfter, isBefore, type GameDate } from '../../../core/date';
import type {
  BrandId,
  CountryId,
  EventDefinitionId,
  PromotionId,
  RegionId,
} from '../../../core/ids';
import type { TraceNode } from '../../../core/trace';
import type { EventDefinition, EventImportance } from '../../../model/entities/event-definition';
import type { Promotion, PromotionStatus } from '../../../model/entities/promotion';
import type { PromotionStyle } from '../../../model/entities/promotion-style';
import { zId } from '../../../model/primitives';
import { occursOn } from '../../../model/recurrence';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { recurrenceText } from '../../calendar/recurrenceText';
import { geographyOf } from '../../world/geography';
import {
  popularityRollup,
  popularityRollupView,
  type PopularityRollupView,
} from '../../world/formulas/popularityRollup';
import { aiShortcutsFor } from '../aiShortcut';
import { profileOf } from '../profiles';
import { AI_SHORTCUT_KEYS, AI_SHORTCUTS, type AiShortcutKey } from '../shortcuts';
import { unitControllerOf } from '../units';
import { canSeePrivate, redactForViewer, visibilityOf, type Redacted } from '../visibility';
import {
  championLinesOf,
  controlledByOf,
  countryPopularity,
  homeOf,
  promotionOrRefuse,
  rosterCountsOf,
  wholePromotion,
  type ChampionLine,
  type ControlledBy,
  type PlaceRef,
} from './shared';

/** Days `showsPerMonth` looks ahead: four weeks. */
export const SHOWS_PER_MONTH_DAYS = 28;

export interface PromotionProfileArgs {
  promotionId: PromotionId;
}

export interface PromotionProfileBrand {
  brandId: BrandId;
  name: string;
  controlledBy: ControlledBy;
}

export interface PromotionProfileShow {
  eventDefinitionId: EventDefinitionId;
  name: string;
  brandId: BrandId | null;
  importance: EventImportance;
  slots: number;
  televised: boolean;
  /** "Every Monday", "1st Saturday of every month", ... */
  recurrenceLabel: string;
}

export interface PromotionProfileShortcut {
  key: AiShortcutKey;
  label: string;
  /** True when the shortcut applies to this promotion (above 0 for the score bonus). */
  on: boolean;
  value: boolean | number;
  trace: TraceNode;
}

export interface PromotionProfile {
  header: {
    name: string;
    shortName: string;
    logoRef: Promotion['logoRef'];
    color: string;
    style: PromotionStyle;
    status: PromotionStatus;
    foundedOn: GameDate;
    homeRegion: PlaceRef<RegionId>;
    homeCountry: PlaceRef<CountryId>;
    controlledBy: ControlledBy;
    /** Active brands, flagship first. */
    brands: PromotionProfileBrand[];
  };
  kpis: {
    popularityHome: { value: number; trace: TraceNode };
    popularityWorld: { value: number; trace: TraceNode };
    prestige: number;
    rosterCount: number;
    crewCount: number;
    championCount: number;
    /** Show dates of the promotion's definitions in the next 28 days. */
    showsPerMonth: number;
    cash: Redacted;
  };
  popularity: PopularityRollupView;
  /** Shows running today, in ID order. */
  shows: PromotionProfileShow[];
  /** Titles in use, in ID order. */
  titles: { titleId: string; name: string; holderNames: string[]; wonOn: GameDate | null }[];
  rules: {
    /** True when the Rival rules can apply: the computer runs it and the field is not level. */
    inForce: boolean;
    levelPlayingField: boolean;
    shortcuts: PromotionProfileShortcut[];
  };
  /** True when the rival desk keeps a profile for it (computer-run promotions). */
  hasProfile: boolean;
  /** What the viewer may not see. */
  hidden: 'cash'[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'promotions.profile': { args: PromotionProfileArgs; result: PromotionProfile };
  }
}

function runsOn(definition: DeepReadonly<EventDefinition>, date: GameDate): boolean {
  return (
    !isAfter(definition.activeFrom, date) &&
    (definition.activeUntil === null || !isBefore(definition.activeUntil, date))
  );
}

/** Show dates of `definitions` from `from` over the next {@link SHOWS_PER_MONTH_DAYS} days. */
export function showDatesAhead(
  definitions: readonly DeepReadonly<EventDefinition>[],
  from: GameDate,
): number {
  let count = 0;
  for (let offset = 0; offset < SHOWS_PER_MONTH_DAYS; offset += 1) {
    const date = addDays(from, offset);
    for (const definition of definitions) {
      if (runsOn(definition, date) && occursOn(definition.recurrence, date)) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * The promotion's shows over the next {@link SHOWS_PER_MONTH_DAYS} days from `from`: the stored
 * shows that are not cancelled, and for a day the calendar has not scheduled yet (past tomorrow
 * plus `horizonDays`) the show dates of its definitions.
 */
export function datedShowsAhead(
  read: GameWorldView,
  promotionId: PromotionId,
  definitions: readonly DeepReadonly<EventDefinition>[],
  from: GameDate,
  horizonDays: number,
): number {
  let count = 0;
  for (let offset = 0; offset < SHOWS_PER_MONTH_DAYS; offset += 1) {
    const date = addDays(from, offset);
    if (offset <= horizonDays + 1) {
      count += read.tables.eventInstances
        .lookup('byDate', date)
        .filter((show) => show.promotionId === promotionId && show.status !== 'cancelled').length;
    } else {
      count += definitions.filter(
        (definition) => runsOn(definition, date) && occursOn(definition.recurrence, date),
      ).length;
    }
  }
  return count;
}

function brandsOf(
  read: GameWorldView,
  promotionId: PromotionId,
  viewer: Viewer,
): PromotionProfileBrand[] {
  return read.tables.brands
    .lookup('byPromotion', promotionId)
    .filter((brand) => brand.active)
    .sort((left, right) => left.priority - right.priority || compareIds(left.id, right.id))
    .map((brand) => ({
      brandId: brand.id,
      name: brand.name,
      controlledBy: controlledByOf(viewer, unitControllerOf(read, promotionId, brand.id)),
    }));
}

function titleLine(line: ChampionLine): PromotionProfile['titles'][number] {
  return {
    titleId: line.titleId,
    name: line.titleName,
    holderNames: line.holderNames,
    wonOn: line.wonOn,
  };
}

export const promotionProfileQuery: QueryDefinition<'promotions.profile'> = defineQuery(
  'promotions.profile',
  {
    args: z.strictObject({ promotionId: zId('promotion') }),
    run: (ctx, args) => {
      const { read, viewer, date, tunables } = ctx;
      const promotion = promotionOrRefuse(read, args.promotionId);
      const geography = geographyOf(read);
      const home = homeOf(geography, promotion.homeRegionId);
      const rollup = popularityRollup(promotion.regionalPop, geography);
      const homePopularity = countryPopularity(rollup, home.homeCountry.id);
      const unit = wholePromotion(promotion.id);
      const champions = championLinesOf(read, unit, date);
      const definitions = [
        ...read.tables.eventDefinitions.lookup('byPromotion', promotion.id),
      ].sort((left, right) => compareIds(left.id, right.id));
      const visibility = visibilityOf(read, viewer, promotion.id);
      const levelPlayingField = read.meta.settings.levelPlayingField;
      const shortcuts = aiShortcutsFor(read, tunables, promotion.id);

      return {
        header: {
          name: promotion.name,
          shortName: promotion.shortName,
          logoRef: promotion.logoRef,
          color: promotion.color,
          style: promotion.style,
          status: promotion.status,
          foundedOn: promotion.foundedOn,
          ...home,
          controlledBy: controlledByOf(viewer, promotion.controller),
          brands: brandsOf(read, promotion.id, viewer),
        },
        kpis: {
          popularityHome: { value: homePopularity.value, trace: homePopularity.trace },
          popularityWorld: { value: rollup.world.value, trace: rollup.world.trace },
          prestige: promotion.prestige,
          ...rosterCountsOf(read, unit, date),
          championCount: champions.filter((line) => line.holderNames.length > 0).length,
          showsPerMonth: datedShowsAhead(
            read,
            promotion.id,
            definitions,
            date,
            tunables.get('calendar.scheduleHorizonDays'),
          ),
          cash: redactForViewer(visibility, promotion.cash, []),
        },
        popularity: popularityRollupView(rollup, geography),
        shows: definitions
          .filter((definition) => runsOn(definition, date))
          .map((definition) => ({
            eventDefinitionId: definition.id,
            name: definition.name,
            brandId: definition.brandId,
            importance: definition.importance,
            slots: definition.format.slots,
            televised: definition.televised,
            recurrenceLabel: recurrenceText(definition.recurrence),
          })),
        titles: champions.map(titleLine),
        rules: {
          inForce: promotion.controller.kind === 'computer' && !levelPlayingField,
          levelPlayingField,
          shortcuts: AI_SHORTCUT_KEYS.map((key) => {
            const shortcut = shortcuts[key];
            return {
              key,
              label: AI_SHORTCUTS[key].label,
              on: typeof shortcut.value === 'boolean' ? shortcut.value : shortcut.value > 0,
              value: shortcut.value,
              trace: shortcut.trace,
            };
          }),
        },
        hasProfile: profileOf(read, promotion.id, null) !== null,
        hidden: canSeePrivate(visibility) ? [] : ['cash'],
      };
    },
  },
);
