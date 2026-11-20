/**
 * Drafts (DRF-01): a draft of people into promotions, and every pick made in it.
 *
 * `drafts` holds one row per draft: its settings, the round-one pick order, how far it has got and
 * who sits out. `draftPicks` holds one row per pick. The draft-start option (DRF-01) writes one
 * `start` draft at new game; the brand drafts (BRW1) can add their own kind and reuse both tables,
 * the pick order and the draft value (`systems/draft/draftValue.ts`).
 *
 * The draft is resumable: everything the next pick needs is in these rows, so a save made
 * mid-draft carries on exactly where it stopped.
 *
 * Design: docs/design/draft.md and docs/design/data-model.md, "Drafts".
 */

import { z } from 'zod';
import { EmploymentRoleSchema } from './employment';
import {
  zGameDate,
  zId,
  zNonNegativeCents,
  zNonNegativeInt,
  zPositiveInt,
  zStat,
} from '../primitives';
import { defineTable } from '../table-def';

/** What a draft is for. `start`: the draft-start option of a new game. */
export const DRAFT_KINDS = ['start'] as const;
export const DraftKindSchema = z.enum(DRAFT_KINDS);
export type DraftKind = z.infer<typeof DraftKindSchema>;

/**
 * `running`: picks are left. `complete`: every promotion is full or the pool is empty, waiting for
 * `draft.finish`. `finished`: closed for good; the game may start.
 */
export const DRAFT_STATUSES = ['running', 'complete', 'finished'] as const;
export const DraftStatusSchema = z.enum(DRAFT_STATUSES);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

/** How the pick order is made. */
export const DRAFT_ORDERS = ['snake', 'random', 'bySize'] as const;
export const DraftOrderSchema = z.enum(DRAFT_ORDERS);
export type DraftOrder = z.infer<typeof DraftOrderSchema>;

/** The show schedule a draft-start game runs on. */
export const DRAFT_SCHEDULES = ['weekly', 'open'] as const;
export const DraftScheduleSchema = z.enum(DRAFT_SCHEDULES);
export type DraftSchedule = z.infer<typeof DraftScheduleSchema>;

/** The two kinds of roster spot a draft fills. */
export const DRAFT_CATEGORIES = ['wrestler', 'staff'] as const;
export const DraftCategorySchema = z.enum(DRAFT_CATEGORIES);
export type DraftCategory = z.infer<typeof DraftCategorySchema>;

/** The level every promotion was set to (the level playing field). */
export const DraftLevelSchema = z.strictObject({
  cash: zNonNegativeCents,
  prestige: zStat,
  /** Popularity in every region of each promotion's home country; none elsewhere. */
  homePopularity: zStat,
});
export type DraftLevel = z.infer<typeof DraftLevelSchema>;

/** One card level of the pool when the draft began. */
export const DraftPoolLevelSchema = z.strictObject({
  level: z.enum(['mainEvent', 'upperCard', 'midCard', 'lowerCard', 'enhancement']),
  inPool: zNonNegativeInt,
  available: zNonNegativeInt,
  female: zNonNegativeInt,
  male: zNonNegativeInt,
  other: zNonNegativeInt,
});
export type DraftPoolLevel = z.infer<typeof DraftPoolLevelSchema>;

export const DraftSettingsSchema = z.strictObject({
  order: DraftOrderSchema,
  /** Wrestlers each promotion drafts. */
  rosterTarget: zPositiveInt,
  /** Staff each promotion drafts; 0 when staff are not drafted. */
  staffTarget: zNonNegativeInt,
  draftStaff: z.boolean(),
  /** Picks join unsigned and are reserved for their promotion instead of signing at the pick. */
  negotiateAfter: z.boolean(),
  schedule: DraftScheduleSchema,
});
export type DraftSettings = z.infer<typeof DraftSettingsSchema>;

export const DraftSchema = z.strictObject({
  id: zId('draft'),
  kind: DraftKindSchema,
  status: DraftStatusSchema,
  createdOn: zGameDate,
  /** Set when the draft is finished. */
  finishedOn: zGameDate.nullable(),
  settings: DraftSettingsSchema,
  /** The promotions drafting, in round one's order. */
  order: z.array(zId('promotion')).min(1),
  /**
   * The next turn: round `floor(turn / order.length)`, slot `turn % order.length` (both 0-based).
   * A turn whose promotion is full is skipped, so turns and picks differ.
   */
  turn: zNonNegativeInt,
  /** Picks made so far. */
  picks: zNonNegativeInt,
  /** Who is left in the pool, by category: rewritten after every command. */
  poolLeft: z.strictObject({ wrestlers: zNonNegativeInt, staff: zNonNegativeInt }),
  level: DraftLevelSchema,
  /** Wrestlers left out of the pool: no contract, not free agents (DRF-07). Sorted. */
  sitOut: z.array(zId('person')),
  /** The pool's mix by card level when the draft began, top level first (DRF-07). */
  poolMix: z.array(DraftPoolLevelSchema),
});
export type Draft = z.infer<typeof DraftSchema>;

/** `signed`: a contract at the pick. `reserved`: unsigned, rights held. `released`: back in the pool. */
export const DRAFT_PICK_STATUSES = ['signed', 'reserved', 'released'] as const;
export const DraftPickStatusSchema = z.enum(DRAFT_PICK_STATUSES);
export type DraftPickStatus = z.infer<typeof DraftPickStatusSchema>;

/** Who chose a pick: a player, the computer for a rival, or the computer for a player. */
export const DRAFT_PICK_SOURCES = ['player', 'computer', 'auto'] as const;
export const DraftPickSourceSchema = z.enum(DRAFT_PICK_SOURCES);
export type DraftPickSource = z.infer<typeof DraftPickSourceSchema>;

export const DraftPickSchema = z.strictObject({
  id: zId('draftPick'),
  draftId: zId('draft'),
  /** 1-based, across the whole draft. */
  number: zPositiveInt,
  /** 1-based. */
  round: zPositiveInt,
  promotionId: zId('promotion'),
  personId: zId('person'),
  category: DraftCategorySchema,
  role: EmploymentRoleSchema,
  source: DraftPickSourceSchema,
  /** The draft value at the pick, 0-100, rounded to one decimal. */
  value: zStat,
  status: DraftPickStatusSchema,
  /** The contract signed at the pick; null when the pick joined unsigned. */
  employmentId: zId('employment').nullable(),
  /** The last day the rights are held, for an unsigned pick. */
  reservedUntil: zGameDate.nullable(),
  pickedOn: zGameDate,
});
export type DraftPick = z.infer<typeof DraftPickSchema>;

export const draftsTable = defineTable({
  kind: 'draft',
  name: 'drafts',
  schema: DraftSchema,
  refs: [
    { path: 'order[]', target: 'promotion', nullable: false },
    { path: 'sitOut[]', target: 'person', nullable: false },
  ],
  indexes: [{ name: 'byStatus', key: (row) => row.status }],
});

export const draftPicksTable = defineTable({
  kind: 'draftPick',
  name: 'draftPicks',
  schema: DraftPickSchema,
  refs: [
    { path: 'draftId', target: 'draft', nullable: false },
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'personId', target: 'person', nullable: false },
    { path: 'employmentId', target: 'employment', nullable: true },
  ],
  indexes: [
    { name: 'byDraft', key: (row) => row.draftId },
    { name: 'byPerson', key: (row) => row.personId },
    { name: 'byDraftPromotion', key: (row) => `${row.draftId}|${row.promotionId}` },
  ],
});
