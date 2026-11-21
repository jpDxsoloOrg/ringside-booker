/**
 * The draft's commands (DRF-01, DRF-03):
 *
 * - `draft.pick { personId }`: the player on the clock drafts someone from the pool;
 * - `draft.simToMyPick { maxPicks? }`: the computer picks for the rivals until a player is on the
 *   clock (or `maxPicks` picks were made, for a draft room that shows picks a few at a time);
 * - `draft.autoPickRest {}`: the computer makes every remaining pick, players' too;
 * - `draft.finish {}`: closes the draft (rivals' remaining picks made, players' passed, rivals'
 *   unsigned picks signed or released); day 1 may start;
 * - `draft.release { personId }`: gives an unsigned pick of yours back to the pool.
 *
 * Only a player in the game may issue them, and `draft.pick` only for the promotion on the clock.
 *
 * Design: docs/design/draft.md#commands.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import type { Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import type { PersonId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { zId } from '../../model/primitives';
import type { Draft } from '../../model/entities/draft';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { moneyText } from '../production/formulas/shared';
import { draftCandidates } from './candidates';
import { DraftPricer } from './pricing';
import {
  finishDraft,
  releasePick,
  reservedPickOf,
  rosterCounts,
  turnOf,
  wantsCategory,
  type FinishSummary,
} from './flow';
import { pickView, type DraftClockView, type DraftPickView } from './queries';
import { DraftRun, loadDraft, openDraft, picksOf } from './session';
import type { Turn } from './order';

export const DRAFT_REASON_CODES = {
  noDraft: 'draft.noDraft',
  notRunning: 'draft.notRunning',
  notYourTurn: 'draft.notYourTurn',
  alreadyDrafted: 'draft.alreadyDrafted',
  sittingOut: 'draft.sittingOut',
  notInPool: 'draft.notInPool',
  rosterFull: 'draft.rosterFull',
  notAllowed: 'notAllowed',
  notReserved: 'draft.notReserved',
  cantAfford: 'draft.cantAfford',
} as const;

/** What a picking command did. */
export interface DraftAdvanceResult {
  picksMade: number;
  /** The picks this command made, newest last (at most the last 50). */
  picks: DraftPickView[];
  status: Draft['status'];
  onTheClock: DraftClockView | null;
}

declare module '../../core/api/maps' {
  interface CommandMap {
    'draft.pick': { args: { personId: PersonId }; result: DraftAdvanceResult };
    'draft.simToMyPick': { args: { maxPicks?: number | undefined }; result: DraftAdvanceResult };
    'draft.autoPickRest': { args: Record<string, never>; result: DraftAdvanceResult };
    'draft.finish': {
      args: Record<string, never>;
      result: FinishSummary & { status: Draft['status'] };
    };
    'draft.release': { args: { personId: PersonId }; result: { personId: PersonId } };
  }
}

const RESULT_PICKS_MAX = 50;

/** A human listed in the game's players, or anyone in a world with no players. */
function playerReasons(read: GameWorldView, issuedBy: Controller): Reason[] {
  if (read.meta.players.length === 0) {
    return [];
  }
  if (
    issuedBy.kind === 'human' &&
    read.meta.players.some((player) => player.playerId === issuedBy.playerId)
  ) {
    return [];
  }
  return [
    {
      code: DRAFT_REASON_CODES.notAllowed,
      message: 'Only a player in this game can run the draft.',
    },
  ];
}

function runningDraft(read: GameWorldView): {
  draft: DeepReadonly<Draft> | null;
  reasons: Reason[];
} {
  const draft = openDraft(read);
  if (draft === null) {
    return {
      draft: null,
      reasons: [{ code: DRAFT_REASON_CODES.noDraft, message: 'There is no draft to run.' }],
    };
  }
  if (draft.status !== 'running') {
    return {
      draft,
      reasons: [
        { code: DRAFT_REASON_CODES.notRunning, message: 'Every pick is made: finish the draft.' },
      ],
    };
  }
  return { draft, reasons: [] };
}

function clockView(
  read: GameWorldView,
  turn: Turn | null,
  issuedBy: Controller,
  pickNumber: number,
): DraftClockView | null {
  if (turn === null) {
    return null;
  }
  const promotion = read.tables.promotions.require(turn.promotionId);
  return {
    promotionId: promotion.id,
    name: promotion.name,
    shortName: promotion.shortName,
    isYou:
      promotion.controller.kind === 'human' &&
      issuedBy.kind === 'human' &&
      promotion.controller.playerId === issuedBy.playerId,
    round: turn.round + 1,
    pick: pickNumber,
  };
}

/** Saves the run, publishes what happened and builds the result. */
function finishRun(ctx: PhaseContext, run: DraftRun, issuedBy: Controller): DraftAdvanceResult {
  const saved = run.save();
  if (run.made.length > 0) {
    ctx.publish('draft.advanced', {
      draftId: saved.id,
      picks: run.made.length,
      nextPick: saved.picks + 1,
    });
  }
  if (saved.status === 'complete') {
    ctx.publish('draft.completed', { draftId: saved.id, picks: saved.picks });
  }
  ctx.log(`Draft ${saved.id}: ${String(run.made.length)} pick(s), ${String(saved.picks)} in all`);
  return {
    picksMade: run.made.length,
    picks: run.made
      .slice(Math.max(0, run.made.length - RESULT_PICKS_MAX))
      .map((pick) => pickView(ctx.read, pick, ctx.date)),
    status: saved.status,
    onTheClock: clockView(ctx.read, run.turn(), issuedBy, saved.picks + 1),
  };
}

function pickRefusals(
  read: GameWorldView,
  personId: PersonId,
  issuedBy: Controller,
  tunables: Parameters<typeof draftCandidates>[1],
): Reason[] {
  const permission = playerReasons(read, issuedBy);
  if (permission.length > 0) {
    return permission;
  }
  const { draft, reasons } = runningDraft(read);
  if (draft === null || reasons.length > 0) {
    return reasons;
  }
  const turn = turnOf(read, draft);
  if (turn === null) {
    return [
      { code: DRAFT_REASON_CODES.notRunning, message: 'Every pick is made: finish the draft.' },
    ];
  }
  const onClock = read.tables.promotions.require(turn.promotionId);
  if (
    onClock.controller.kind !== 'human' ||
    issuedBy.kind !== 'human' ||
    onClock.controller.playerId !== issuedBy.playerId
  ) {
    return [
      {
        code: DRAFT_REASON_CODES.notYourTurn,
        message: `It is ${onClock.name}'s pick, not yours.`,
        subject: { kind: 'promotion', id: onClock.id },
      },
    ];
  }
  const subject = { kind: 'person', id: personId } as const;
  if (read.tables.people.get(personId) === undefined) {
    return [
      {
        code: DRAFT_REASON_CODES.notInPool,
        message: 'There is nobody with that id.',
        field: 'personId',
      },
    ];
  }
  const picks = picksOf(read, draft.id);
  if (picks.some((pick) => pick.personId === personId && pick.status !== 'released')) {
    return [
      {
        code: DRAFT_REASON_CODES.alreadyDrafted,
        message: 'They have already been drafted.',
        subject,
        field: 'personId',
      },
    ];
  }
  if (draft.sitOut.includes(personId)) {
    return [
      {
        code: DRAFT_REASON_CODES.sittingOut,
        message: 'They are sitting out: not in the draft pool.',
        subject,
        field: 'personId',
      },
    ];
  }
  const [candidate] = draftCandidates(read, tunables, {
    date: read.meta.currentDate,
    draftStaff: draft.settings.draftStaff,
    onlyUnsigned: true,
    only: new Set([personId]),
  });
  if (candidate === undefined) {
    return [
      {
        code: DRAFT_REASON_CODES.notInPool,
        message: 'They are not in the draft pool.',
        subject,
        field: 'personId',
      },
    ];
  }
  const count = rosterCounts(picks).get(turn.promotionId);
  if (!wantsCategory(draft, count, candidate.category)) {
    const target =
      candidate.category === 'wrestler' ? draft.settings.rosterTarget : draft.settings.staffTarget;
    return [
      {
        code: DRAFT_REASON_CODES.rosterFull,
        message:
          target === 0
            ? 'Staff are not drafted in this game.'
            : `Your ${candidate.category === 'wrestler' ? 'wrestler' : 'staff'} roster is full (${String(target)}).`,
        subject,
        field: 'personId',
      },
    ];
  }
  if (!draft.settings.negotiateAfter) {
    // DRF-10: the season is paid at the pick, and cash may not go below zero in the draft.
    const price = new DraftPricer(read, tunables, read.meta.currentDate).price(
      turn.promotionId,
      personId,
    );
    if (price.cost.total > onClock.cash) {
      return [
        {
          code: DRAFT_REASON_CODES.cantAfford,
          message: `Their season contract costs ${moneyText(price.cost.total)}; you have ${moneyText(onClock.cash)}.`,
          subject,
          field: 'personId',
        },
      ];
    }
  }
  return [];
}

export const draftPickCommand = defineCommand('draft.pick', {
  args: z.strictObject({ personId: zId('person') }),
  validate: (read, args, issuedBy, env) =>
    pickRefusals(read, args.personId, issuedBy, env.tunables),
  apply: (ctx, args, issuedBy) => {
    const draft = openDraft(ctx.read);
    if (draft === null) {
      throw new Error('draft.pick: no open draft');
    }
    const run = new DraftRun(ctx, loadDraft(ctx.read, ctx.tunables, draft, ctx.date));
    const turn = run.turn();
    const candidate = run.board.candidate(args.personId);
    if (turn === null || candidate === undefined || !run.board.isAvailable(args.personId)) {
      throw new Error(`draft.pick: ${args.personId} cannot be picked now`);
    }
    run.pick(turn, candidate, 'player');
    return finishRun(ctx, run, issuedBy);
  },
});

function advanceRefusals(read: GameWorldView, issuedBy: Controller): Reason[] {
  const permission = playerReasons(read, issuedBy);
  return permission.length > 0 ? permission : runningDraft(read).reasons;
}

export const draftSimToMyPickCommand = defineCommand('draft.simToMyPick', {
  args: z.strictObject({ maxPicks: z.number().int().min(1).max(100_000).optional() }),
  validate: (read, _args, issuedBy) => advanceRefusals(read, issuedBy),
  apply: (ctx, args, issuedBy) => {
    const draft = openDraft(ctx.read);
    if (draft === null) {
      throw new Error('draft.simToMyPick: no open draft');
    }
    const run = new DraftRun(ctx, loadDraft(ctx.read, ctx.tunables, draft, ctx.date));
    const max = args.maxPicks ?? Number.POSITIVE_INFINITY;
    run.runUntil(() => run.made.length >= max, false);
    return finishRun(ctx, run, issuedBy);
  },
});

export const draftAutoPickRestCommand = defineCommand('draft.autoPickRest', {
  args: z.strictObject({}),
  validate: (read, _args, issuedBy) => advanceRefusals(read, issuedBy),
  apply: (ctx, _args, issuedBy) => {
    const draft = openDraft(ctx.read);
    if (draft === null) {
      throw new Error('draft.autoPickRest: no open draft');
    }
    const run = new DraftRun(ctx, loadDraft(ctx.read, ctx.tunables, draft, ctx.date));
    run.runUntil(() => false, true);
    return finishRun(ctx, run, issuedBy);
  },
});

export const draftFinishCommand = defineCommand('draft.finish', {
  args: z.strictObject({}),
  validate: (read, _args, issuedBy) => {
    const permission = playerReasons(read, issuedBy);
    if (permission.length > 0) {
      return permission;
    }
    return openDraft(read) === null
      ? [{ code: DRAFT_REASON_CODES.noDraft, message: 'There is no draft to finish.' }]
      : [];
  },
  apply: (ctx) => {
    const draft = openDraft(ctx.read);
    if (draft === null) {
      throw new Error('draft.finish: no open draft');
    }
    const summary = finishDraft(ctx, draft);
    const finished = ctx.read.tables.drafts.require(draft.id);
    ctx.publish('draft.finished', {
      draftId: draft.id,
      picks: finished.picks,
      signed: summary.signed,
      released: summary.released,
    });
    ctx.log(
      `Draft ${draft.id} finished: ${String(summary.picksMade)} last pick(s), ${String(summary.signed)} signed, ${String(summary.released)} released`,
    );
    return { ...summary, status: finished.status };
  },
});

export const draftReleaseCommand = defineCommand('draft.release', {
  args: z.strictObject({ personId: zId('person') }),
  validate: (read, args, issuedBy) => {
    const permission = playerReasons(read, issuedBy);
    if (permission.length > 0) {
      return permission;
    }
    const mine = read.tables.promotions
      .values()
      .filter(
        (promotion) =>
          promotion.controller.kind === 'human' &&
          issuedBy.kind === 'human' &&
          promotion.controller.playerId === issuedBy.playerId,
      )
      .map((promotion) => promotion.id);
    return reservedPickOf(read, args.personId, mine) === undefined
      ? [
          {
            code: DRAFT_REASON_CODES.notReserved,
            message: 'They are not an unsigned draft pick of yours.',
            field: 'personId',
            subject: { kind: 'person', id: args.personId },
          },
        ]
      : [];
  },
  apply: (ctx, args, issuedBy) => {
    const mine = ctx.read.tables.promotions
      .values()
      .filter(
        (promotion) =>
          promotion.controller.kind === 'human' &&
          issuedBy.kind === 'human' &&
          promotion.controller.playerId === issuedBy.playerId,
      )
      .map((promotion) => promotion.id);
    const pick = reservedPickOf(ctx.read, args.personId, mine);
    if (pick === undefined) {
      throw new Error('draft.release: no reserved pick');
    }
    releasePick(ctx, pick);
    ctx.publish('draft.released', {
      draftId: pick.draftId,
      personId: pick.personId,
      promotionId: pick.promotionId,
    });
    return { personId: args.personId };
  },
});

export const draftCommands = [
  draftPickCommand,
  draftSimToMyPickCommand,
  draftAutoPickRestCommand,
  draftFinishCommand,
  draftReleaseCommand,
];
