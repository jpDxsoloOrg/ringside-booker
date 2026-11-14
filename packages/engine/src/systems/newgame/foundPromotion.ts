/**
 * Founding a promotion: a new company with no roster, sized small, medium or large.
 *
 * One table of founding numbers (the `newgame.found.<size>.*` tunables) serves new game and any
 * later feature that founds a promotion mid-game, so the same size label always means the same
 * start. The founder hires from the free-agent pool; the optional starter kit adds a vacant
 * championship and a weekly show so the day loop has a show to stop on.
 *
 * See docs/design/new-game.md#founding-a-promotion.
 */

import { yearMonthOf, type Weekday } from '../../core/date';
import type { PromotionId, RegionId } from '../../core/ids';
import { cents } from '../../core/money';
import type { PhaseContext } from '../../core/pipeline/context';
import type { PromotionStyle } from '../../model/entities/promotion-style';
import { geographyOf } from '../world/geography';
import type { EngineTunables } from '../tunables';
import { founderTitlePrestige, titlePrestigeTraceRef } from '../titles/traces';
import type { FoundingSize } from './input';

/** What the founder chose. */
export interface FoundPromotionSpec {
  readonly name: string;
  /** Already upper-cased and checked against the promotion short-name pattern. */
  readonly shortName: string;
  readonly homeRegionId: RegionId;
  readonly style: PromotionStyle;
  readonly size: FoundingSize;
  /** `#rrggbb`. */
  readonly color: string;
  /** Add a vacant singles title and a weekly show. */
  readonly starterKit: boolean;
  /** The weekly show's day (0 = Monday). Only used with the starter kit. */
  readonly weeklyShowDay: Weekday;
}

/** A size's founding numbers. Cash is in cents. */
export interface FoundingValues {
  cash: number;
  homePopularity: number;
  countryPopularity: number;
  prestige: number;
}

/** The founding numbers for one size, read from the tunables. */
export function foundingValues(tunables: EngineTunables, size: FoundingSize): FoundingValues {
  return {
    cash: tunables.get(`newgame.found.${size}.cash`),
    homePopularity: tunables.get(`newgame.found.${size}.homePopularity`),
    countryPopularity: tunables.get(`newgame.found.${size}.countryPopularity`),
    prestige: tunables.get(`newgame.found.${size}.prestige`),
  };
}

/**
 * Creates the promotion (and its starter kit) through `ctx.tx` and returns its ID. It is founded
 * on `ctx.date`, run by the computer until controllers are assigned, with every production level
 * and staff policy at 0, no logo and no roster.
 */
export function foundPromotion(ctx: PhaseContext, spec: FoundPromotionSpec): PromotionId {
  const { tx, tunables, date } = ctx;
  const values = foundingValues(tunables, spec.size);
  const geography = geographyOf(tx.view);
  const homeCountry = geography.countryOf(spec.homeRegionId);

  const regionalPop: Record<RegionId, number> = {};
  for (const region of geography.regionsOf(homeCountry.id)) {
    const popularity =
      region.id === spec.homeRegionId ? values.homePopularity : values.countryPopularity;
    // Zero is left out of a sparse popularity record, never stored.
    if (popularity > 0) {
      regionalPop[region.id] = popularity;
    }
  }

  const promotion = tx.create('promotions', {
    name: spec.name,
    shortName: spec.shortName,
    logoRef: null,
    foundedOn: date,
    status: 'active',
    homeRegionId: spec.homeRegionId,
    regionalPop,
    popularityGains: { month: yearMonthOf(date), byRegion: {} },
    prestige: values.prestige,
    cash: cents(values.cash),
    style: spec.style,
    ownerPersonId: null,
    bookerPersonId: null,
    parentPromotionId: null,
    production: {
      stage: 0,
      camera: 0,
      editing: 0,
      pyro: 0,
      music: 0,
      writing: 0,
      marketing: 0,
      backOffice: 0,
    },
    policies: { catering: 0, travel: 0, medical: 0 },
    color: spec.color,
    // The human controller is assigned by `wld.assignControllers`.
    controller: { kind: 'computer' },
    ledgerMonths: [],
  });
  ctx.log(`Founded ${spec.name} (${spec.shortName}) as ${promotion.id}, size ${spec.size}`);

  if (spec.starterKit) {
    const titlePrestige = founderTitlePrestige(tunables);
    const title = tx.create('titles', {
      promotionId: promotion.id,
      brandId: null,
      name: `${spec.shortName} Championship`,
      holderCount: 1,
      division: { gender: 'open', minWeightKg: null, maxWeightKg: null },
      prestige: titlePrestige.value,
      status: 'active',
      introducedOn: date,
      retiredOn: null,
      imageRef: null,
      color: spec.color,
    });
    // The belt's prestige gets a Why? like any other title's (CRTV1-01).
    ctx.recordTrace(titlePrestigeTraceRef(title.id), date, titlePrestige);
    const show = tx.create('eventDefinitions', {
      promotionId: promotion.id,
      brandId: null,
      name: `${spec.shortName} Weekly`,
      importance: 'regular',
      recurrence: { kind: 'weekly', weekdays: [spec.weeklyShowDay] },
      format: { slots: tunables.get('newgame.found.weeklyShowSlots'), preShowSlots: 0 },
      televised: false,
      preferredRegionId: spec.homeRegionId,
      preferredVenueId: null,
      activeFrom: date,
      activeUntil: null,
      logoRef: null,
    });
    ctx.log(`Starter kit: title ${title.id} and weekly show ${show.id}`);
  }
  return promotion.id;
}
