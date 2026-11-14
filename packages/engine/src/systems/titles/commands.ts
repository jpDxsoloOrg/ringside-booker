/**
 * The booker's title commands (CRTV1-03): create, edit, award, vacate, retire and reactivate.
 *
 * These are the office's overrides: what titles exist and, outside the ring, who holds them. Match
 * results that change titles are EVT3's. Each command checks everything before writing (the shared
 * checks in `validate.ts`), applies in one transaction, returns plain JSON and publishes one event
 * (none for `edit`). The computer's rival desk uses the same commands on its own promotions.
 * Nothing here changes morale, momentum, popularity or prestige.
 *
 * Design: docs/design/titles.md#commands.
 */

import { z } from 'zod';
import { defineCommand } from '../../core/api/command';
import type { Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import type { GameDate } from '../../core/date';
import type { BrandId, PersonId, PromotionId, TeamId, TitleId, TitleReignId } from '../../core/ids';
import {
  DIVISION_GENDERS,
  HEX_COLOR_PATTERN,
  TITLE_HOLDER_COUNTS,
  type Title,
  type TitleDivision,
  type TitleHolderCount,
} from '../../model/entities/title';
import { MAX_REIGN_HOLDERS } from '../../model/entities/title-reign';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { isEligibleForTitle } from '../workers/helpers/eligibility';
import {
  bookerVacancyExplanation,
  BOOKER_VACANCY_REASON_KEY,
  reactivateTitle,
  retireTitle,
  titleSourceOf,
  vacateTitle,
} from './doors';
import { startingPrestige } from './formulas/startingPrestige';
import { isEligibleHolder } from './helpers/eligibility';
import { ringNameForTitle } from './helpers/employment';
import { currentReign } from './helpers/holders';
import { closeReign, openReign } from './reigns';
import { TitleTierSchema, type TitleTier } from './tiers';
import { titlePrestigeTraceRef } from './traces';
import {
  checkPromotionForCreate,
  checkTitleBrand,
  checkTitleCommand,
  checkTitleName,
  checkWeightRange,
  cleanTitleName,
} from './validate';

export interface TitleCreateArgs {
  promotionId: PromotionId;
  brandId: BrandId | null;
  name: string;
  holderCount: TitleHolderCount;
  division: TitleDivision;
  tier: TitleTier;
  color: string;
}

export interface TitleEditArgs {
  titleId: TitleId;
  name?: string | undefined;
  brandId?: BrandId | null | undefined;
  division?: TitleDivision | undefined;
  color?: string | undefined;
  holderCount?: TitleHolderCount | undefined;
}

export interface TitleAwardArgs {
  titleId: TitleId;
  holderIds: PersonId[];
  teamId: TeamId | null;
}

declare module '../../core/api/maps' {
  interface CommandMap {
    'titles.create': { args: TitleCreateArgs; result: { titleId: TitleId } };
    'titles.edit': { args: TitleEditArgs; result: { titleId: TitleId } };
    'titles.award': {
      args: TitleAwardArgs;
      result: { reignId: TitleReignId; previousReignId: TitleReignId | null };
    };
    'titles.vacate': { args: { titleId: TitleId }; result: { reignId: TitleReignId } };
    'titles.retire': {
      args: { titleId: TitleId };
      result: { endedReignId: TitleReignId | null };
    };
    'titles.reactivate': { args: { titleId: TitleId }; result: { titleId: TitleId } };
  }
}

/** The longest name the arguments accept; `nameLength` explains the 60-character rule. */
const NAME_ARG_MAX = 200;

/** The division as a form sends it. The weight order is a `weightRange` reason, not a parse error. */
const DivisionArgsSchema = z.strictObject({
  gender: z.enum(DIVISION_GENDERS),
  minWeightKg: z.number().positive().nullable(),
  maxWeightKg: z.number().positive().nullable(),
});

const HolderCountSchema = z.literal(TITLE_HOLDER_COUNTS);
const ColorSchema = z.string().regex(HEX_COLOR_PATTERN, 'Expected a colour such as #c9a227');
const TitleIdArgsSchema = z.strictObject({ titleId: zId('title') });

const CreateArgsSchema = z.strictObject({
  promotionId: zId('promotion'),
  brandId: zId('brand').nullable(),
  name: z.string().max(NAME_ARG_MAX),
  holderCount: HolderCountSchema,
  division: DivisionArgsSchema,
  tier: TitleTierSchema,
  color: ColorSchema,
});

const EditArgsSchema = z.strictObject({
  titleId: zId('title'),
  name: z.string().max(NAME_ARG_MAX).optional(),
  brandId: zId('brand').nullable().optional(),
  division: DivisionArgsSchema.optional(),
  color: ColorSchema.optional(),
  holderCount: HolderCountSchema.optional(),
});

const AwardArgsSchema = z.strictObject({
  titleId: zId('title'),
  holderIds: z.array(zId('person')).min(1).max(MAX_REIGN_HOLDERS),
  teamId: zId('team').nullable(),
});

// ---------------------------------------------------------------------------------------------
// titles.create

function createRefusals(
  read: GameWorldView,
  args: TitleCreateArgs,
  issuedBy: DeepReadonly<Controller>,
): Reason[] {
  const promotion = checkPromotionForCreate(read, args.promotionId, issuedBy);
  if (promotion.length > 0) {
    return promotion;
  }
  return [
    ...checkTitleBrand(read, args.promotionId, args.brandId),
    ...checkTitleName(read, args.promotionId, args.name, null),
    ...checkWeightRange(args.division),
  ];
}

export const createTitleCommand = defineCommand('titles.create', {
  args: CreateArgsSchema,
  validate: createRefusals,
  apply: (ctx, args, issuedBy) => {
    const promotion = ctx.read.tables.promotions.require(args.promotionId);
    const prestige = startingPrestige(
      { tier: args.tier, promotionPrestige: promotion.prestige },
      { tunables: ctx.tunables },
    );
    const title = ctx.tx.create('titles', {
      promotionId: promotion.id,
      brandId: args.brandId,
      name: cleanTitleName(args.name),
      holderCount: args.holderCount,
      division: { ...args.division },
      prestige: prestige.value,
      status: 'active',
      introducedOn: ctx.date,
      retiredOn: null,
      imageRef: null,
      color: args.color,
    });
    ctx.recordTrace(titlePrestigeTraceRef(title.id), ctx.date, prestige);
    ctx.publish('title.created', {
      titleId: title.id,
      promotionId: promotion.id,
      brandId: title.brandId,
      source: titleSourceOf(issuedBy),
    });
    return { titleId: title.id };
  },
});

// ---------------------------------------------------------------------------------------------
// titles.edit

/** WRK1's reason, as it reads when a new division would take the title off its champion. */
function lostEligibilityText(ringName: string, message: string): string {
  const reason = `${message.charAt(0).toLowerCase()}${message.slice(1)}`;
  return `${ringName} couldn't hold it any more: ${reason}. Vacate it first.`;
}

/** The current champions a new division would rule out, with WRK1's reasons re-worded. */
function divisionRefusals(
  read: GameWorldView,
  title: DeepReadonly<Title>,
  division: TitleDivision,
  date: GameDate,
): Reason[] {
  const reign = currentReign(read, title.id);
  if (reign === null) {
    return [];
  }
  const reasons: Reason[] = [];
  for (const personId of reign.holderIds) {
    const person = read.tables.people.get(personId);
    if (person === undefined) {
      continue;
    }
    const ringName = ringNameForTitle(read, personId, title.promotionId, date);
    for (const reason of isEligibleForTitle(person, { ...title, division })) {
      if (reason.code === 'titleRetired') {
        continue;
      }
      reasons.push({
        ...reason,
        message: lostEligibilityText(ringName, reason.message),
        field: 'division',
      });
    }
  }
  return reasons;
}

function editRefusals(
  read: GameWorldView,
  args: TitleEditArgs,
  issuedBy: DeepReadonly<Controller>,
): Reason[] {
  const check = checkTitleCommand(read, args.titleId, issuedBy);
  if (!check.ok) {
    return check.reasons;
  }
  const { title } = check;
  const reasons: Reason[] = [];
  if (args.name !== undefined) {
    reasons.push(...checkTitleName(read, title.promotionId, args.name, title.id));
  }
  if (args.brandId !== undefined) {
    reasons.push(...checkTitleBrand(read, title.promotionId, args.brandId));
  }
  if (args.division !== undefined) {
    reasons.push(...checkWeightRange(args.division));
  }
  if (
    args.holderCount !== undefined &&
    args.holderCount !== title.holderCount &&
    currentReign(read, title.id) !== null
  ) {
    reasons.push({
      code: 'holderCountLocked',
      message: 'Vacate the title before changing how many people hold it.',
      field: 'holderCount',
      subject: { kind: 'title', id: title.id },
    });
  }
  if (args.division !== undefined && reasons.length === 0) {
    reasons.push(...divisionRefusals(read, title, args.division, read.meta.currentDate));
  }
  return reasons;
}

export const editTitleCommand = defineCommand('titles.edit', {
  args: EditArgsSchema,
  validate: editRefusals,
  apply: (ctx, args) => {
    const patch: Partial<Title> = {};
    if (args.name !== undefined) {
      patch.name = cleanTitleName(args.name);
    }
    if (args.brandId !== undefined) {
      patch.brandId = args.brandId;
    }
    if (args.division !== undefined) {
      patch.division = { ...args.division };
    }
    if (args.color !== undefined) {
      patch.color = args.color;
    }
    if (args.holderCount !== undefined) {
      patch.holderCount = args.holderCount;
    }
    if (Object.keys(patch).length > 0) {
      ctx.tx.update('titles', args.titleId, patch);
    }
    return { titleId: args.titleId };
  },
});

// ---------------------------------------------------------------------------------------------
// titles.award

/** The `holderIds[i]` a person-level reason is about: the second mention for a duplicate. */
function holderField(holderIds: readonly PersonId[], reason: Reason): string | undefined {
  if (reason.subject?.kind !== 'person') {
    return undefined;
  }
  const personId: string = reason.subject.id;
  const indexes = holderIds.flatMap((holderId, index) => (holderId === personId ? [index] : []));
  // A duplicate is about its second mention; every other reason about the first.
  const index = reason.code === 'duplicateHolder' ? indexes.at(-1) : indexes[0];
  return index === undefined ? undefined : `holderIds[${String(index)}]`;
}

function fieldFor(holderIds: readonly PersonId[], reason: Reason): string | undefined {
  switch (reason.code) {
    case 'wrongHolderCount':
      return 'holderIds';
    case 'teamMismatch':
      return 'teamId';
    default:
      return holderField(holderIds, reason);
  }
}

function sameHolders(left: readonly PersonId[], right: readonly PersonId[]): boolean {
  const set = new Set(left);
  return left.length === right.length && right.every((personId) => set.has(personId));
}

function awardRefusals(
  read: GameWorldView,
  args: TitleAwardArgs,
  issuedBy: DeepReadonly<Controller>,
): Reason[] {
  const check = checkTitleCommand(read, args.titleId, issuedBy);
  if (!check.ok) {
    return check.reasons;
  }
  const { title } = check;
  const reasons = isEligibleHolder(read, title, args, read.meta.currentDate).map((reason) => {
    const field = fieldFor(args.holderIds, reason);
    return field === undefined ? reason : { ...reason, field };
  });
  const reign = currentReign(read, title.id);
  if (reign !== null && sameHolders(reign.holderIds, args.holderIds)) {
    reasons.push({
      code: 'alreadyChampion',
      message:
        reign.holderIds.length === 1
          ? `${reign.holderNamesAtTime.join(' & ')} already holds the ${title.name}.`
          : `${reign.holderNamesAtTime.join(' & ')} already hold the ${title.name}.`,
      field: 'holderIds',
      subject: { kind: 'title', id: title.id },
    });
  }
  return reasons;
}

export const awardTitleCommand = defineCommand('titles.award', {
  args: AwardArgsSchema,
  validate: awardRefusals,
  apply: (ctx, args, issuedBy) => {
    const title = ctx.read.tables.titles.require(args.titleId);
    const previous = currentReign(ctx.read, title.id);
    if (previous !== null) {
      closeReign(ctx, { reignId: previous.id, endReason: 'stripped', endedInSegmentId: null });
    }
    const reign = openReign(ctx, {
      titleId: title.id,
      holderIds: args.holderIds,
      teamId: args.teamId,
      wonInSegmentId: null,
    });
    const previousReignId = previous?.id ?? null;
    ctx.publish('title.awarded', {
      titleId: title.id,
      promotionId: title.promotionId,
      reignId: reign.id,
      holderIds: [...reign.holderIds],
      teamId: reign.teamId,
      previousReignId,
      source: titleSourceOf(issuedBy),
    });
    return { reignId: reign.id, previousReignId };
  },
});

// ---------------------------------------------------------------------------------------------
// titles.vacate, titles.retire, titles.reactivate

function vacateRefusals(
  read: GameWorldView,
  args: { titleId: TitleId },
  issuedBy: DeepReadonly<Controller>,
): Reason[] {
  const check = checkTitleCommand(read, args.titleId, issuedBy);
  if (!check.ok) {
    return check.reasons;
  }
  if (currentReign(read, check.title.id) === null) {
    return [
      {
        code: 'alreadyVacant',
        message: `The ${check.title.name} is already vacant.`,
        subject: { kind: 'title', id: check.title.id },
      },
    ];
  }
  return [];
}

export const vacateTitleCommand = defineCommand('titles.vacate', {
  args: TitleIdArgsSchema,
  validate: vacateRefusals,
  apply: (ctx, args, issuedBy) => ({
    reignId: vacateTitle(ctx, {
      titleId: args.titleId,
      reasonKey: BOOKER_VACANCY_REASON_KEY,
      source: titleSourceOf(issuedBy),
      explanation: bookerVacancyExplanation(),
    }),
  }),
});

export const retireTitleCommand = defineCommand('titles.retire', {
  args: TitleIdArgsSchema,
  validate: (read, args, issuedBy) => {
    const check = checkTitleCommand(read, args.titleId, issuedBy);
    return check.ok ? [] : check.reasons;
  },
  apply: (ctx, args, issuedBy) => ({
    endedReignId: retireTitle(ctx, { titleId: args.titleId, source: titleSourceOf(issuedBy) }),
  }),
});

export const reactivateTitleCommand = defineCommand('titles.reactivate', {
  args: TitleIdArgsSchema,
  validate: (read, args, issuedBy) => {
    const check = checkTitleCommand(read, args.titleId, issuedBy, { allowRetired: true });
    if (!check.ok) {
      return check.reasons;
    }
    if (check.title.status !== 'retired') {
      return [
        {
          code: 'notRetired',
          message: `The ${check.title.name} isn't retired.`,
          subject: { kind: 'title', id: check.title.id },
        },
      ];
    }
    return [];
  },
  apply: (ctx, args, issuedBy) => {
    reactivateTitle(ctx, { titleId: args.titleId, source: titleSourceOf(issuedBy) });
    return { titleId: args.titleId };
  },
});

export const titlesCommands = [
  createTitleCommand,
  editTitleCommand,
  awardTitleCommand,
  vacateTitleCommand,
  retireTitleCommand,
  reactivateTitleCommand,
] as const;
