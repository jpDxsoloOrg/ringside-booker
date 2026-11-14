/**
 * The checks the storyline commands share (CRTV3-03): the storyline exists, the issuer runs its
 * promotion and it has not ended; the people in it work for the promotion; and the name, summary
 * and brand rules `storylines.create` and `storylines.edit` share. Every reason is written for the
 * player and names its subject, and `field` when a form field is at fault.
 *
 * Design: docs/design/storylines.md#commands.
 */

import { controlsPromotion, type Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import type { BrandId, PersonId, PromotionId, StorylineId } from '../../core/ids';
import { promotionStatusKey } from '../../model/entities/employment';
import {
  MAX_STORYLINE_MEMBERS,
  MAX_STORYLINE_SUMMARY_LENGTH,
  MIN_STORYLINE_MEMBERS,
  type Storyline,
  type StorylineMember,
} from '../../model/entities/storyline';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { activeEmploymentAt } from './rows';

/** The most characters a storyline name may have, after trimming. */
export const STORYLINE_NAME_MAX_LENGTH = 80;

/** Every reason code the storyline commands and `storylines.endPreview` use. */
export const STORYLINE_COMMAND_REASONS = {
  notFound: 'storylines.notFound',
  notYours: 'storylines.notYours',
  ended: 'storylines.ended',
  promotionNotFound: 'storylines.promotionNotFound',
  memberNotEmployed: 'storylines.memberNotEmployed',
  duplicateMember: 'storylines.duplicateMember',
  tooManyMembers: 'storylines.tooManyMembers',
  noMembers: 'storylines.noMembers',
  nameLength: 'storylines.nameLength',
  nameTaken: 'storylines.nameTaken',
  summaryLength: 'storylines.summaryLength',
  brandNotInPromotion: 'storylines.brandNotInPromotion',
  alreadyMember: 'storylines.alreadyMember',
  notMember: 'storylines.notMember',
  lastMember: 'storylines.lastMember',
} as const;

/** The warnings `storylines.create` returns with a storyline it created. They never block. */
export const STORYLINE_WARNINGS = {
  manyActive: 'storylines.manyActive',
  oneSided: 'storylines.oneSided',
} as const;

/** A storyline found and checked, or the reasons the command stops at. */
export type OwnStorylineCheck =
  | { readonly ok: true; readonly storyline: DeepReadonly<Storyline> }
  | { readonly ok: false; readonly reasons: Reason[] };

function promotionName(read: GameWorldView, promotionId: PromotionId): string {
  return read.tables.promotions.get(promotionId)?.name ?? 'another promotion';
}

/** The person's name at the promotion: their ring name there, else their default ring name. */
export function memberName(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
): string {
  return (
    activeEmploymentAt(read, personId, promotionId)?.ringName ??
    read.tables.people.get(personId)?.defaultRingName ??
    'That person'
  );
}

/**
 * The storyline and the reasons a command may not change it, stopping at the first: unknown
 * (`storylines.notFound`), run by someone else (`storylines.notYours`), or ended
 * (`storylines.ended`).
 */
export function checkOwnStoryline(
  read: GameWorldView,
  storylineId: StorylineId,
  issuedBy: DeepReadonly<Controller>,
): OwnStorylineCheck {
  const subject = { kind: 'storyline', id: storylineId } as const;
  const storyline = read.tables.storylines.get(storylineId);
  if (storyline === undefined) {
    return {
      ok: false,
      reasons: [
        {
          code: STORYLINE_COMMAND_REASONS.notFound,
          message: "That storyline doesn't exist.",
          field: 'storylineId',
          subject,
        },
      ],
    };
  }
  if (!controlsPromotion(read, storyline.promotionId, issuedBy)) {
    return {
      ok: false,
      reasons: [
        {
          code: STORYLINE_COMMAND_REASONS.notYours,
          message: `That storyline belongs to ${promotionName(read, storyline.promotionId)}.`,
          subject,
        },
      ],
    };
  }
  if (storyline.status === 'ended') {
    return {
      ok: false,
      reasons: [
        {
          code: STORYLINE_COMMAND_REASONS.ended,
          message: `${storyline.name} has ended; ended storylines can't be changed.`,
          subject,
        },
      ],
    };
  }
  return { ok: true, storyline };
}

/** {@link checkOwnStoryline} as a list of reasons: empty when the command may change it. */
export function ownStorylineReasons(
  read: GameWorldView,
  storylineId: StorylineId,
  issuedBy: DeepReadonly<Controller>,
): Reason[] {
  const check = checkOwnStoryline(read, storylineId, issuedBy);
  return check.ok ? [] : check.reasons;
}

/** True when the person has an active contract with the promotion. */
export function worksFor(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
): boolean {
  return read.tables.employments
    .lookup('byPromotionStatus', promotionStatusKey(promotionId, 'active'))
    .some((employment) => employment.personId === personId);
}

/** Options for {@link memberReasons}. */
export interface MemberReasonOptions {
  /**
   * The field a person's reason names, from their index in `members`. Defaults to
   * `members[i].personId`.
   */
  readonly fieldOf?: (index: number) => string;
}

/**
 * The reasons `members` may not make up a storyline of `promotionId`: someone without an active
 * contract there (`storylines.memberNotEmployed`), someone listed twice
 * (`storylines.duplicateMember`, on the second mention), more than 12
 * (`storylines.tooManyMembers`) or nobody (`storylines.noMembers`).
 */
export function memberReasons(
  read: GameWorldView,
  promotionId: PromotionId,
  members: readonly Pick<StorylineMember, 'personId'>[],
  options: MemberReasonOptions = {},
): Reason[] {
  const fieldOf = options.fieldOf ?? ((index: number) => `members[${String(index)}].personId`);
  if (members.length < MIN_STORYLINE_MEMBERS) {
    return [
      {
        code: STORYLINE_COMMAND_REASONS.noMembers,
        message: 'Add at least one person to the storyline.',
        field: 'members',
      },
    ];
  }
  const reasons: Reason[] = [];
  if (members.length > MAX_STORYLINE_MEMBERS) {
    reasons.push({
      code: STORYLINE_COMMAND_REASONS.tooManyMembers,
      message: `A storyline can have up to ${String(MAX_STORYLINE_MEMBERS)} people.`,
      field: 'members',
    });
  }
  const seen = new Set<PersonId>();
  members.forEach((member, index) => {
    const subject = { kind: 'person', id: member.personId } as const;
    const name = memberName(read, member.personId, promotionId);
    if (seen.has(member.personId)) {
      reasons.push({
        code: STORYLINE_COMMAND_REASONS.duplicateMember,
        message: `${name} is listed twice.`,
        field: fieldOf(index),
        subject,
      });
      return;
    }
    seen.add(member.personId);
    if (!worksFor(read, member.personId, promotionId)) {
      reasons.push({
        code: STORYLINE_COMMAND_REASONS.memberNotEmployed,
        message: `${name} doesn't work for ${promotionName(read, promotionId)}.`,
        field: fieldOf(index),
        subject,
      });
    }
  });
  return reasons;
}

/** The issuer may start storylines for `promotionId`: it exists and they run it. */
export function promotionReasons(
  read: GameWorldView,
  promotionId: PromotionId,
  issuedBy: DeepReadonly<Controller>,
): Reason[] {
  const promotion = read.tables.promotions.get(promotionId);
  const subject = { kind: 'promotion', id: promotionId } as const;
  if (promotion === undefined) {
    return [
      {
        code: STORYLINE_COMMAND_REASONS.promotionNotFound,
        message: "That promotion doesn't exist.",
        field: 'promotionId',
        subject,
      },
    ];
  }
  if (!controlsPromotion(read, promotion.id, issuedBy)) {
    return [
      {
        code: STORYLINE_COMMAND_REASONS.notYours,
        message: `${promotion.name} isn't yours. You can only start storylines for your own promotion.`,
        field: 'promotionId',
        subject,
      },
    ];
  }
  return [];
}

/** The text as stored: spaces trimmed from both ends. */
export function cleanStorylineText(text: string): string {
  return text.trim();
}

/**
 * Name checks: 1 to 80 characters after trimming (`storylines.nameLength`), and not the name of
 * another active storyline of the promotion, ignoring case (`storylines.nameTaken`). An ended
 * storyline's name may be used again. `exceptStorylineId` is the storyline being renamed.
 */
export function nameReasons(
  read: GameWorldView,
  promotionId: PromotionId,
  name: string,
  exceptStorylineId: StorylineId | null,
): Reason[] {
  const clean = cleanStorylineText(name);
  if (clean.length === 0) {
    return [
      {
        code: STORYLINE_COMMAND_REASONS.nameLength,
        message: 'Give the storyline a name.',
        field: 'name',
      },
    ];
  }
  if (clean.length > STORYLINE_NAME_MAX_LENGTH) {
    return [
      {
        code: STORYLINE_COMMAND_REASONS.nameLength,
        message: `Storyline names can be up to ${String(STORYLINE_NAME_MAX_LENGTH)} characters.`,
        field: 'name',
      },
    ];
  }
  const lower = clean.toLowerCase();
  const clash = read.tables.storylines
    .lookup('byPromotion', promotionId)
    .find(
      (storyline) =>
        storyline.id !== exceptStorylineId &&
        storyline.status === 'active' &&
        storyline.name.trim().toLowerCase() === lower,
    );
  if (clash !== undefined) {
    return [
      {
        code: STORYLINE_COMMAND_REASONS.nameTaken,
        message: `You already run a storyline called ${clash.name}.`,
        field: 'name',
        subject: { kind: 'storyline', id: clash.id },
      },
    ];
  }
  return [];
}

/** The summary may be up to 500 characters after trimming (`storylines.summaryLength`). */
export function summaryReasons(summary: string): Reason[] {
  if (cleanStorylineText(summary).length > MAX_STORYLINE_SUMMARY_LENGTH) {
    return [
      {
        code: STORYLINE_COMMAND_REASONS.summaryLength,
        message: `Summaries can be up to ${String(MAX_STORYLINE_SUMMARY_LENGTH)} characters.`,
        field: 'summary',
      },
    ];
  }
  return [];
}

/**
 * A brand (or null, the whole promotion) must belong to the promotion and still run
 * (`storylines.brandNotInPromotion` for both).
 */
export function brandReasons(
  read: GameWorldView,
  promotionId: PromotionId,
  brandId: BrandId | null,
): Reason[] {
  if (brandId === null) {
    return [];
  }
  const brand = read.tables.brands.get(brandId);
  const subject = { kind: 'brand', id: brandId } as const;
  if (brand?.promotionId !== promotionId) {
    return [
      {
        code: STORYLINE_COMMAND_REASONS.brandNotInPromotion,
        message: `That brand isn't part of ${promotionName(read, promotionId)}.`,
        field: 'brandId',
        subject,
      },
    ];
  }
  if (!brand.active) {
    return [
      {
        code: STORYLINE_COMMAND_REASONS.brandNotInPromotion,
        message: `${brand.name} is no longer running. Pick an active brand.`,
        field: 'brandId',
        subject,
      },
    ];
  }
  return [];
}
