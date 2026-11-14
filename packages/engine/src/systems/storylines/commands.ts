/**
 * The booker's storyline commands (CRTV3-03): create, edit, add and remove members, change sides
 * and end.
 *
 * Each command checks everything before writing (`validation.ts`) against the controller that
 * issued it (D-07), applies in one transaction and returns plain JSON. Rival storylines can't be
 * changed from the player's seat, and ended storylines can't be changed at all. There is
 * deliberately no delete: segments keep pointing at their storylines and the history stays
 * readable.
 *
 * Nothing here changes a worker's morale, momentum or alignment (D-09): a storyline side is the
 * story's, not the worker's; turning a worker is CRTV7's.
 *
 * Design: docs/design/storylines.md#commands.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import { INVALID_ARGS, type Reason } from '../../core/api/result';
import type { BrandId, PersonId, PromotionId, StorylineId } from '../../core/ids';
import {
  MAX_STORYLINE_MEMBERS,
  STORYLINE_SIDES,
  type StorylineMember,
  type StorylineSide,
} from '../../model/entities/storyline';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import { activeStorylinesOf } from './context';
import { endStoryline, startStoryline, type StorylineEndOutcome } from './lifecycle';
import {
  brandReasons,
  checkOwnStoryline,
  cleanStorylineText,
  memberName,
  memberReasons,
  nameReasons,
  ownStorylineReasons,
  promotionReasons,
  STORYLINE_COMMAND_REASONS,
  STORYLINE_WARNINGS,
  summaryReasons,
} from './validation';

export interface StorylineCreateArgs {
  promotionId: PromotionId;
  name: string;
  summary?: string | undefined;
  brandId?: BrandId | null | undefined;
  members: StorylineMember[];
}

export interface StorylineEditArgs {
  storylineId: StorylineId;
  name?: string | undefined;
  summary?: string | undefined;
  brandId?: BrandId | null | undefined;
}

export interface StorylineMemberArgs {
  storylineId: StorylineId;
  personId: PersonId;
  side: StorylineSide;
}

declare module '../../core/api/maps' {
  interface CommandMap {
    'storylines.create': {
      args: StorylineCreateArgs;
      result: { storylineId: StorylineId; warnings: Reason[] };
    };
    'storylines.edit': { args: StorylineEditArgs; result: null };
    'storylines.addMember': { args: StorylineMemberArgs; result: null };
    'storylines.removeMember': {
      args: { storylineId: StorylineId; personId: PersonId };
      result: null;
    };
    'storylines.setSide': { args: StorylineMemberArgs; result: null };
    'storylines.end': { args: { storylineId: StorylineId }; result: StorylineEndOutcome };
  }
}

/**
 * The longest name and summary the arguments accept. Past the real limits (80 and 500) the
 * commands refuse with `storylines.nameLength` / `storylines.summaryLength`, which a form can show.
 */
const NAME_ARG_MAX = 200;
const SUMMARY_ARG_MAX = 2000;
/** More members than a storyline may have parse, so `storylines.tooManyMembers` can explain. */
const MEMBERS_ARG_MAX = 50;

const MemberArgsSchema = z.strictObject({
  personId: zId('person'),
  side: z.enum(STORYLINE_SIDES),
});

const CreateArgsSchema = z.strictObject({
  promotionId: zId('promotion'),
  name: z.string().max(NAME_ARG_MAX),
  summary: z.string().max(SUMMARY_ARG_MAX).optional(),
  brandId: zId('brand').nullable().optional(),
  members: z.array(MemberArgsSchema).max(MEMBERS_ARG_MAX),
});

const EditArgsSchema = z.strictObject({
  storylineId: zId('storyline'),
  name: z.string().max(NAME_ARG_MAX).optional(),
  summary: z.string().max(SUMMARY_ARG_MAX).optional(),
  brandId: zId('brand').nullable().optional(),
});

const MemberCommandArgsSchema = z.strictObject({
  storylineId: zId('storyline'),
  personId: zId('person'),
  side: z.enum(STORYLINE_SIDES),
});

const RemoveMemberArgsSchema = z.strictObject({
  storylineId: zId('storyline'),
  personId: zId('person'),
});

const StorylineIdArgsSchema = z.strictObject({ storylineId: zId('storyline') });

// ---------------------------------------------------------------------------------------------
// storylines.create

/** The warnings a new storyline comes with. They never block the command. */
function createWarnings(
  read: GameWorldView,
  promotionId: PromotionId,
  members: readonly StorylineMember[],
  softLimit: number,
): Reason[] {
  const warnings: Reason[] = [];
  const active = activeStorylinesOf(read, promotionId).length;
  if (softLimit > 0 && active >= softLimit) {
    warnings.push({
      code: STORYLINE_WARNINGS.manyActive,
      message: `You already run ${String(active)} storylines; it gets hard to keep them all hot.`,
      subject: { kind: 'promotion', id: promotionId },
    });
  }
  const sides = new Set(members.map((member) => member.side));
  if (!sides.has('face') || !sides.has('heel')) {
    warnings.push({
      code: STORYLINE_WARNINGS.oneSided,
      message: 'No one on the other side yet.',
      field: 'members',
    });
  }
  return warnings;
}

export const createStorylineCommand = defineCommand('storylines.create', {
  args: CreateArgsSchema,
  validate: (read, args, issuedBy) => {
    const promotion = promotionReasons(read, args.promotionId, issuedBy);
    if (promotion.length > 0) {
      return promotion;
    }
    return [
      ...nameReasons(read, args.promotionId, args.name, null),
      ...summaryReasons(args.summary ?? ''),
      ...brandReasons(read, args.promotionId, args.brandId ?? null),
      ...memberReasons(read, args.promotionId, args.members),
    ];
  },
  apply: (ctx, args) => {
    // Warned before the new storyline is counted: "You already run 6".
    const warnings = createWarnings(
      ctx.read,
      args.promotionId,
      args.members,
      ctx.tunables.get('storylines.activeSoftLimit'),
    );
    const storylineId = startStoryline(ctx, {
      promotionId: args.promotionId,
      brandId: args.brandId ?? null,
      name: cleanStorylineText(args.name),
      summary: cleanStorylineText(args.summary ?? ''),
      members: args.members,
      source: 'player',
    });
    return { storylineId, warnings };
  },
});

// ---------------------------------------------------------------------------------------------
// storylines.edit

export const editStorylineCommand = defineCommand('storylines.edit', {
  args: EditArgsSchema,
  validate: (read, args, issuedBy) => {
    if (args.name === undefined && args.summary === undefined && args.brandId === undefined) {
      return [
        {
          code: INVALID_ARGS,
          message: 'Change the name, the summary or the brand.',
          field: 'storylineId',
        },
      ];
    }
    const check = checkOwnStoryline(read, args.storylineId, issuedBy);
    if (!check.ok) {
      return check.reasons;
    }
    const { storyline } = check;
    return [
      ...(args.name === undefined
        ? []
        : nameReasons(read, storyline.promotionId, args.name, storyline.id)),
      ...(args.summary === undefined ? [] : summaryReasons(args.summary)),
      ...(args.brandId === undefined
        ? []
        : brandReasons(read, storyline.promotionId, args.brandId)),
    ];
  },
  apply: (ctx, args) => {
    // No event: a new name or summary doesn't change the story.
    ctx.tx.update('storylines', args.storylineId, {
      ...(args.name === undefined ? {} : { name: cleanStorylineText(args.name) }),
      ...(args.summary === undefined ? {} : { summary: cleanStorylineText(args.summary) }),
      ...(args.brandId === undefined ? {} : { brandId: args.brandId }),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------
// storylines.addMember

export const addStorylineMemberCommand = defineCommand('storylines.addMember', {
  args: MemberCommandArgsSchema,
  validate: (read, args, issuedBy) => {
    const check = checkOwnStoryline(read, args.storylineId, issuedBy);
    if (!check.ok) {
      return check.reasons;
    }
    const { storyline } = check;
    const subject = { kind: 'person', id: args.personId } as const;
    if (storyline.members.some((member) => member.personId === args.personId)) {
      return [
        {
          code: STORYLINE_COMMAND_REASONS.alreadyMember,
          message: `${memberName(read, args.personId, storyline.promotionId)} is already in ${storyline.name}.`,
          field: 'personId',
          subject,
        },
      ];
    }
    const reasons = memberReasons(read, storyline.promotionId, [{ personId: args.personId }], {
      fieldOf: () => 'personId',
    });
    if (storyline.members.length >= MAX_STORYLINE_MEMBERS) {
      reasons.push({
        code: STORYLINE_COMMAND_REASONS.tooManyMembers,
        message: `${storyline.name} already has ${String(MAX_STORYLINE_MEMBERS)} people, the most a storyline can have.`,
        field: 'personId',
        subject: { kind: 'storyline', id: storyline.id },
      });
    }
    return reasons;
  },
  apply: (ctx, args) => {
    const storyline = ctx.read.tables.storylines.require(args.storylineId);
    ctx.tx.update('storylines', storyline.id, {
      members: [
        ...storyline.members.map((member) => ({ personId: member.personId, side: member.side })),
        { personId: args.personId, side: args.side },
      ],
    });
    ctx.publish('storyline.membersChanged', {
      storylineId: storyline.id,
      promotionId: storyline.promotionId,
      added: [args.personId],
      removed: [],
      sideChanged: [],
    });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------
// storylines.removeMember and storylines.setSide

/** The reason someone isn't in the storyline, or none. */
function notMemberReasons(
  read: GameWorldView,
  storylineId: StorylineId,
  personId: PersonId,
): Reason[] {
  const storyline = read.tables.storylines.require(storylineId);
  if (storyline.members.some((member) => member.personId === personId)) {
    return [];
  }
  return [
    {
      code: STORYLINE_COMMAND_REASONS.notMember,
      message: `${memberName(read, personId, storyline.promotionId)} isn't in ${storyline.name}.`,
      field: 'personId',
      subject: { kind: 'person', id: personId },
    },
  ];
}

export const removeStorylineMemberCommand = defineCommand('storylines.removeMember', {
  args: RemoveMemberArgsSchema,
  validate: (read, args, issuedBy) => {
    const own = ownStorylineReasons(read, args.storylineId, issuedBy);
    if (own.length > 0) {
      return own;
    }
    const notMember = notMemberReasons(read, args.storylineId, args.personId);
    if (notMember.length > 0) {
      return notMember;
    }
    const storyline = read.tables.storylines.require(args.storylineId);
    if (storyline.members.length <= 1) {
      return [
        {
          code: STORYLINE_COMMAND_REASONS.lastMember,
          message: 'A storyline needs at least one person. End it instead.',
          field: 'personId',
          subject: { kind: 'storyline', id: storyline.id },
        },
      ];
    }
    return [];
  },
  apply: (ctx, args) => {
    // Heat, last progress and linked segments stay: only the member list changes.
    const storyline = ctx.read.tables.storylines.require(args.storylineId);
    ctx.tx.update('storylines', storyline.id, {
      members: storyline.members
        .filter((member) => member.personId !== args.personId)
        .map((member) => ({ personId: member.personId, side: member.side })),
    });
    ctx.publish('storyline.membersChanged', {
      storylineId: storyline.id,
      promotionId: storyline.promotionId,
      added: [],
      removed: [args.personId],
      sideChanged: [],
    });
    return null;
  },
});

export const setStorylineSideCommand = defineCommand('storylines.setSide', {
  args: MemberCommandArgsSchema,
  validate: (read, args, issuedBy) => {
    const own = ownStorylineReasons(read, args.storylineId, issuedBy);
    return own.length > 0 ? own : notMemberReasons(read, args.storylineId, args.personId);
  },
  apply: (ctx, args) => {
    const storyline = ctx.read.tables.storylines.require(args.storylineId);
    const current = storyline.members.find((member) => member.personId === args.personId);
    if (current?.side === args.side) {
      // Already on that side: nothing to change, no event.
      return null;
    }
    // Only the story's side changes, in place; the worker's alignment stays (CRTV7 turns workers).
    ctx.tx.update('storylines', storyline.id, {
      members: storyline.members.map((member) => ({
        personId: member.personId,
        side: member.personId === args.personId ? args.side : member.side,
      })),
    });
    ctx.publish('storyline.membersChanged', {
      storylineId: storyline.id,
      promotionId: storyline.promotionId,
      added: [],
      removed: [],
      sideChanged: [args.personId],
    });
    return null;
  },
});

// ---------------------------------------------------------------------------------------------
// storylines.end

export const endStorylineCommand = defineCommand('storylines.end', {
  args: StorylineIdArgsSchema,
  validate: (read, args, issuedBy) => ownStorylineReasons(read, args.storylineId, issuedBy),
  apply: (ctx, args) => endStoryline(ctx, args.storylineId),
});

/** Every storyline command, in the order the docs list them. */
export const storylinesCommands = [
  createStorylineCommand,
  editStorylineCommand,
  addStorylineMemberCommand,
  removeStorylineMemberCommand,
  setStorylineSideCommand,
  endStorylineCommand,
] as const;
