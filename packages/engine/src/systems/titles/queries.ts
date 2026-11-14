/**
 * The titles queries (CRTV1-02): `titles.list`, `titles.detail` and `titles.eligibleHolders`.
 * Titles and lineages are public, so every viewer sees the same rows; only `editable` differs.
 * Unknown titles come back as the reason `titleNotFound`, never a throw.
 *
 * Design: docs/design/titles.md#queries.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import type { TitleId } from '../../core/ids';
import { zId } from '../../model/primitives';
import { eligibleHoldersOf, type EligibleHolders } from './eligibleHolders';
import {
  TITLE_NOT_FOUND,
  TITLE_NOT_FOUND_MESSAGE,
  titleDetailOf,
  type TitleDetail,
} from './lineage';
import {
  TITLE_LIST_SCOPES,
  TITLE_LIST_STATUSES,
  titleListOf,
  type TitleListArgs,
  type TitleListResult,
} from './list';

declare module '../../core/api/maps' {
  interface QueryMap {
    'titles.list': { args: TitleListArgs; result: TitleListResult };
    'titles.detail': { args: { titleId: TitleId }; result: TitleDetail };
    'titles.eligibleHolders': {
      args: { titleId: TitleId; includeIneligible: boolean };
      result: EligibleHolders;
    };
  }
}

function titleNotFound(titleId: TitleId): never {
  return refuseQuery({
    code: TITLE_NOT_FOUND,
    message: TITLE_NOT_FOUND_MESSAGE,
    subject: { kind: 'title', id: titleId },
  });
}

export const titlesListQuery: QueryDefinition<'titles.list'> = defineQuery('titles.list', {
  args: z.strictObject({
    scope: z.enum(TITLE_LIST_SCOPES),
    status: z.enum(TITLE_LIST_STATUSES),
  }),
  run: (ctx, args) => titleListOf(ctx, args),
});

export const titlesDetailQuery: QueryDefinition<'titles.detail'> = defineQuery('titles.detail', {
  args: z.strictObject({ titleId: zId('title') }),
  run: (ctx, args) => titleDetailOf(ctx, args.titleId) ?? titleNotFound(args.titleId),
});

export const titlesEligibleHoldersQuery: QueryDefinition<'titles.eligibleHolders'> = defineQuery(
  'titles.eligibleHolders',
  {
    args: z.strictObject({ titleId: zId('title'), includeIneligible: z.boolean() }),
    run: (ctx, args) =>
      eligibleHoldersOf(ctx, args.titleId, args.includeIneligible) ?? titleNotFound(args.titleId),
  },
);

/** Every titles query, for the system bundle. */
export const TITLES_QUERIES: readonly QueryDefinition[] = [
  titlesListQuery,
  titlesDetailQuery,
  titlesEligibleHoldersQuery,
];
