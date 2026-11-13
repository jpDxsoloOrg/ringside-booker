/**
 * Per-show production costs: what stage, camera, editing and pyro cost on one show, and on every
 * show in a coming window, in whole cents.
 *
 * Design: docs/design/production.md#per-show-costs. One show's cost is the sum of
 * {@link areaCost} over `PER_SHOW_AREAS` at the show's importance, one line per area. The coming
 * shows' cost is one line per show ("Hardpan Friday, 8 Jan (minor)") nesting that show's cost.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import { dayOfMonth, month, type GameDate } from '../../../core/date';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { Production } from '../../../model/entities/promotion';
import type { EngineTunables } from '../../tunables';
import { PER_SHOW_AREAS } from '../areas';
import { areaCost } from './areaCost';
import { areaLineLabel } from './productionMonthlyCost';
import { PER_SHOW_COSTS_DOC_REF } from './shared';

/** The note on a show whose stage, camera, editing and pyro are all at level 0. */
export const NO_PAID_PRODUCTION_NOTE = 'No paid production on this show';

/** The note on a window with no shows in it. */
export const NO_SHOWS_IN_WINDOW_NOTE = 'No shows in the window';

const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface ProductionShowCostInputs {
  promotionName: string;
  showName: string;
  importance: EventImportance;
  levels: Production;
}

/** One show's stage, camera, editing and pyro costs, in cents (unit `money`). */
export function productionShowCost(
  inputs: ProductionShowCostInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc(`${inputs.showName} production`, 0, {
    unit: 'money',
    docRef: PER_SHOW_COSTS_DOC_REF,
    startLabel: 'Nothing yet',
  });
  if (PER_SHOW_AREAS.every((area) => inputs.levels[area] === 0)) {
    return calc.note(NO_PAID_PRODUCTION_NOTE).done();
  }
  for (const area of PER_SHOW_AREAS) {
    const level = inputs.levels[area];
    calc.add(
      areaLineLabel(area, level),
      areaCost({ area, level, importance: inputs.importance }, deps),
    );
  }
  return calc.done();
}

/** One show in the window {@link upcomingShowCost} adds up. */
export interface UpcomingShow {
  name: string;
  date: GameDate;
  importance: EventImportance;
}

export interface UpcomingShowCostInputs {
  promotionName: string;
  shows: readonly UpcomingShow[];
  levels: Production;
}

/** The line one show adds: "Hardpan Friday, 8 Jan (minor)". */
export function upcomingShowLabel(show: UpcomingShow): string {
  const monthName = MONTH_SHORT_NAMES[month(show.date) - 1] ?? '';
  return `${show.name}, ${String(dayOfMonth(show.date))} ${monthName} (${show.importance})`;
}

/** The per-show production cost of every show in a window, in cents (unit `money`). */
export function upcomingShowCost(
  inputs: UpcomingShowCostInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc(`${inputs.promotionName} production on coming shows`, 0, {
    unit: 'money',
    docRef: PER_SHOW_COSTS_DOC_REF,
    startLabel: 'Nothing yet',
  });
  if (inputs.shows.length === 0) {
    return calc.note(NO_SHOWS_IN_WINDOW_NOTE).done();
  }
  for (const show of inputs.shows) {
    calc.add(
      upcomingShowLabel(show),
      productionShowCost(
        {
          promotionName: inputs.promotionName,
          showName: show.name,
          importance: show.importance,
          levels: inputs.levels,
        },
        deps,
      ),
    );
  }
  return calc.done();
}
