/**
 * The eight production areas as the production system sees them: what the player reads, how each
 * one is paid for and which ledger category its money goes to.
 *
 * Design: docs/design/production.md#areas. The areas and their 0..10 levels live on the promotion
 * (`PRODUCTION_AREAS`, `ProductionSchema` in `model/entities/promotion.ts`).
 */

import type { LedgerCategory } from '../../model/entities/ledger-entry';
import { PRODUCTION_AREAS, type ProductionArea } from '../../model/entities/promotion';

/** What the player reads for each area. */
export const AREA_LABELS: Readonly<Record<ProductionArea, string>> = Object.freeze({
  stage: 'Stage',
  camera: 'Camera',
  editing: 'Editing',
  pyro: 'Pyro',
  music: 'Music',
  writing: 'Writing',
  marketing: 'Marketing',
  backOffice: 'Back office',
});

/** How an area is paid for: a cost on every show, or a monthly overhead. */
export type AreaCostKind = 'perShow' | 'monthly';

export const AREA_COST_KIND: Readonly<Record<ProductionArea, AreaCostKind>> = Object.freeze({
  stage: 'perShow',
  camera: 'perShow',
  editing: 'perShow',
  pyro: 'perShow',
  music: 'monthly',
  writing: 'monthly',
  marketing: 'monthly',
  backOffice: 'monthly',
});

/** The ledger categories production money is posted under. */
export type ProductionLedgerCategory = Extract<
  LedgerCategory,
  'production' | 'marketing' | 'backOffice'
>;

export const PRODUCTION_LEDGER_CATEGORIES: readonly ProductionLedgerCategory[] = Object.freeze([
  'production',
  'marketing',
  'backOffice',
]);

/** Where each area's running cost goes in the books. */
export const AREA_LEDGER_CATEGORY: Readonly<Record<ProductionArea, ProductionLedgerCategory>> =
  Object.freeze({
    stage: 'production',
    camera: 'production',
    editing: 'production',
    pyro: 'production',
    music: 'production',
    writing: 'production',
    marketing: 'marketing',
    backOffice: 'backOffice',
  });

/** The areas paid for on every show (stage, camera, editing, pyro), in `PRODUCTION_AREAS` order. */
export const PER_SHOW_AREAS: readonly ProductionArea[] = Object.freeze(
  PRODUCTION_AREAS.filter((area) => AREA_COST_KIND[area] === 'perShow'),
);

/** The areas paid for monthly (music, writing, marketing, back office), in `PRODUCTION_AREAS` order. */
export const MONTHLY_AREAS: readonly ProductionArea[] = Object.freeze(
  PRODUCTION_AREAS.filter((area) => AREA_COST_KIND[area] === 'monthly'),
);
