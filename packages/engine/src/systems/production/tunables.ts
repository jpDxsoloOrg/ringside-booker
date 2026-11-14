/**
 * The production system's balance numbers (ECO7-01): what each production level costs to run and
 * to buy, and how far marketing and back office let popularity grow. All in the `Production`
 * category with a docRef into docs/design/production.md. Money is in whole cents. 0 means 0
 * everywhere: a 0 price makes that area free, a 0 multiplier makes that kind of show free.
 *
 * EVT4 owns the show-quality ceiling and its keys under the same `production.` prefix
 * (`production.ceilingBase`, `production.ceilingWeight.*`, `production.bonusSlotThreshold`,
 * `production.bonusSlotMinImportance`); none of the keys here may take those names.
 */

import { defineTunables } from '../../core/tunables/define';

/** The tunables editor group every production key belongs to. */
export const PRODUCTION_TUNABLE_CATEGORY = 'Production';

const AREA_COSTS_DOC = 'production.md#area-costs';
const PER_SHOW_DOC = 'production.md#per-show-costs';
const UPGRADE_DOC = 'production.md#upgrade-fee';
const CEILING_DOC = 'production.md#popularity-ceiling';
const DRAG_DOC = 'production.md#popularity-drag';
const TV_DOC = 'production.md#tv-camera-minimum';
const COMING_SHOWS_DOC = 'production.md#coming-shows';
const RIVAL_BUDGET_DOC = 'production.md#rival-production-budget';

/** The most any production price may be: $100,000,000. */
const PRICE_MAX = 10_000_000_000;

function showCost(defaultCents: number, area: string) {
  return {
    kind: 'integer',
    default: defaultCents,
    min: 0,
    max: PRICE_MAX,
    unit: 'money',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: `What ${area} at level 10 costs for one regular show`,
    docRef: AREA_COSTS_DOC,
  } as const;
}

function monthlyCost(defaultCents: number, area: string) {
  return {
    kind: 'integer',
    default: defaultCents,
    min: 0,
    max: PRICE_MAX,
    unit: 'money/month',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: `What ${area} at level 10 costs each month`,
    docRef: AREA_COSTS_DOC,
  } as const;
}

function upgradeFee(defaultCents: number, area: string) {
  return {
    kind: 'integer',
    default: defaultCents,
    min: 0,
    max: PRICE_MAX,
    unit: 'money',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: `One-time fee for raising ${area} all the way from level 0 to 10`,
    docRef: UPGRADE_DOC,
  } as const;
}

function showCostMultiplier(defaultValue: number, importance: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: 10,
    step: 0.05,
    unit: 'multiplier',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: `Stage, camera, editing and pyro costs are multiplied by this for a ${importance} show`,
    docRef: PER_SHOW_DOC,
  } as const;
}

function ceilingPerLevel(defaultValue: number, area: string) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 'points',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: `Popularity ceiling added by each level of ${area}`,
    docRef: CEILING_DOC,
  } as const;
}

export const productionTunables = defineTunables({
  'production.costCurve': {
    kind: 'number',
    default: 3,
    min: 1,
    max: 5,
    step: 0.1,
    unit: 'ratio',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: 'How steeply production costs rise with level; 1 is a straight line',
    docRef: AREA_COSTS_DOC,
  },
  'production.showCost.stage': showCost(12_000_000, 'stage'),
  'production.showCost.camera': showCost(15_000_000, 'camera'),
  'production.showCost.editing': showCost(10_000_000, 'editing'),
  'production.showCost.pyro': showCost(6_000_000, 'pyro'),
  'production.monthlyCost.music': monthlyCost(50_000_000, 'music'),
  'production.monthlyCost.writing': monthlyCost(25_000_000, 'writing'),
  'production.monthlyCost.marketing': monthlyCost(120_000_000, 'marketing'),
  'production.monthlyCost.backOffice': monthlyCost(100_000_000, 'back office'),
  'production.upgradeFee.stage': upgradeFee(60_000_000, 'stage'),
  'production.upgradeFee.camera': upgradeFee(50_000_000, 'camera'),
  'production.upgradeFee.editing': upgradeFee(40_000_000, 'editing'),
  'production.upgradeFee.pyro': upgradeFee(25_000_000, 'pyro'),
  'production.upgradeFee.music': upgradeFee(30_000_000, 'music'),
  'production.upgradeFee.writing': upgradeFee(20_000_000, 'writing'),
  'production.upgradeFee.marketing': upgradeFee(15_000_000, 'marketing'),
  'production.upgradeFee.backOffice': upgradeFee(15_000_000, 'back office'),
  'production.showCostMultiplier.house': showCostMultiplier(0.25, 'house'),
  'production.showCostMultiplier.minor': showCostMultiplier(0.5, 'minor'),
  'production.showCostMultiplier.regular': showCostMultiplier(1, 'regular'),
  'production.showCostMultiplier.major': showCostMultiplier(1.5, 'major'),
  'production.showCostMultiplier.flagship': showCostMultiplier(2.5, 'flagship'),
  'production.popularityCeiling.base': {
    kind: 'number',
    default: 20,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: 'Popularity ceiling with no marketing and no back office',
    docRef: CEILING_DOC,
  },
  'production.popularityCeiling.perMarketingLevel': ceilingPerLevel(5, 'marketing'),
  'production.popularityCeiling.perBackOfficeLevel': ceilingPerLevel(5, 'back office'),
  'production.popularityDrag.fractionPerDay': {
    kind: 'number',
    default: 0.02,
    min: 0,
    max: 1,
    step: 0.005,
    unit: 'ratio',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: 'Share of the popularity above the ceiling lost each day',
    docRef: DRAG_DOC,
  },
  'production.popularityDrag.minPerDay': {
    kind: 'number',
    default: 0.05,
    min: 0,
    max: 10,
    step: 0.01,
    unit: 'points/day',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: 'Least popularity lost each day while above the ceiling (0 = no floor)',
    docRef: DRAG_DOC,
  },
  'production.tvDealMinCamera': {
    kind: 'integer',
    default: 1,
    min: 0,
    max: 10,
    unit: 'points',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: 'Lowest camera level allowed while the promotion has a TV deal',
    docRef: TV_DOC,
  },
  'production.feeNeedsCash': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: 'An upgrade fee must be covered by cash in hand',
    docRef: UPGRADE_DOC,
  },
  'production.forecastDays': {
    kind: 'integer',
    default: 28,
    min: 1,
    max: 90,
    unit: 'days',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description: 'How many days ahead the production screen adds up the coming shows',
    docRef: COMING_SHOWS_DOC,
  },
  // TEMPORARY (ECO7-05): the rival production budget, until AIP8's rival production desk.
  'production.rivalBudget.lowerBelowMonths': {
    kind: 'number',
    default: 12,
    min: 0,
    max: 60,
    step: 0.5,
    unit: 'months',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description:
      'Temporary rival rule: a computer promotion lowers production when its cash covers fewer months of production costs than this (0 = never)',
    docRef: RIVAL_BUDGET_DOC,
  },
  'production.rivalBudget.deepCutBelowMonths': {
    kind: 'number',
    default: 6,
    min: 0,
    max: 60,
    step: 0.5,
    unit: 'months',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description:
      'Temporary rival rule: below this many months of production costs in cash, a computer promotion also cuts levels that lower a ceiling it is using (0 = never)',
    docRef: RIVAL_BUDGET_DOC,
  },
  'production.rivalBudget.raiseAboveMonths': {
    kind: 'number',
    default: 24,
    min: 0,
    max: 120,
    step: 1,
    unit: 'months',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description:
      'Temporary rival rule: a computer promotion raises one held-back level a month when its cash covers this many months of production costs after the change (0 = never)',
    docRef: RIVAL_BUDGET_DOC,
  },
  'production.rivalBudget.headroom': {
    kind: 'number',
    default: 5,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description:
      'Temporary rival rule: room a computer promotion keeps between its best recent show or region and its ceilings',
    docRef: RIVAL_BUDGET_DOC,
  },
  'production.rivalBudget.lookbackDays': {
    kind: 'integer',
    default: 28,
    min: 1,
    max: 365,
    unit: 'days',
    category: PRODUCTION_TUNABLE_CATEGORY,
    description:
      "Temporary rival rule: how far back a computer promotion's best show is looked for",
    docRef: RIVAL_BUDGET_DOC,
  },
});
