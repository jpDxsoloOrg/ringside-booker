/**
 * `workers.explain`: the "Why?" behind one number in a worker list, built when it is asked for.
 *
 * List rows carry no traces. This query runs the same formulas the profile does for one person and
 * one number, so a list, its "Why?" and the profile can never disagree.
 *
 * Design: docs/design/workers.md#workers-list.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery } from '../../../core/api/result';
import type { PersonId } from '../../../core/ids';
import type { TraceNode } from '../../../core/trace';
import { zId } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { createPopularityRoller, popularityRollup } from '../../world/formulas/popularityRollup';
import { geographyOf } from '../../world/geography';
import { overallOf } from '../formulas/roleRating';
import { primaryEmploymentOf } from '../helpers/employment';
import { mainRoleOf } from '../helpers/roles';
import { WORKER_NOT_FOUND } from './profile';

/** The numbers of a list row that can be explained. */
export const WORKER_EXPLAIN_METRICS = ['overall', 'topPopularity', 'worldPopularity'] as const;
export type WorkerExplainMetric = (typeof WORKER_EXPLAIN_METRICS)[number];

export interface WorkerExplainArgs {
  personId: PersonId;
  metric: WorkerExplainMetric;
}

/** One number with how it was worked out. */
export interface WorkerExplanation {
  value: number;
  trace: TraceNode;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'workers.explain': { args: WorkerExplainArgs; result: WorkerExplanation };
  }
}

/**
 * The traced `metric` of `personId`, or null when there is no such person.
 *
 * - `overall`: the rating in their main role.
 * - `topPopularity`: the roll-up of the country they are best known in. Someone unknown everywhere
 *   has no such country, so they get the world roll-up, which shows the zeroes.
 * - `worldPopularity`: the whole map's roll-up.
 */
export function workerExplanationOf(
  read: GameWorldView,
  args: WorkerExplainArgs,
  tunables: EngineTunables,
): WorkerExplanation | null {
  const person = read.tables.people.get(args.personId);
  if (person === undefined) {
    return null;
  }
  if (args.metric === 'overall') {
    const primary = primaryEmploymentOf(read, person.id, read.meta.currentDate);
    const rating = overallOf(person, mainRoleOf(person, primary), { tunables });
    return { value: rating.value, trace: rating.trace };
  }
  const geography = geographyOf(read);
  const rollup = popularityRollup(person.regionalPop, geography);
  if (args.metric === 'topPopularity') {
    // The same pick as the list's, so both name the same country.
    const { top } = createPopularityRoller(geography).rollValues(person.regionalPop);
    const country = top === null ? undefined : rollup.countries.get(top.countryId);
    if (country !== undefined) {
      return { value: country.value, trace: country.trace };
    }
  }
  return { value: rollup.world.value, trace: rollup.world.trace };
}

export const explainQuery: QueryDefinition<'workers.explain'> = defineQuery('workers.explain', {
  args: z.strictObject({ personId: zId('person'), metric: z.enum(WORKER_EXPLAIN_METRICS) }),
  run: (ctx, args) =>
    workerExplanationOf(ctx.read, args, ctx.tunables) ??
    refuseQuery({ code: WORKER_NOT_FOUND, message: 'No such worker' }),
});
