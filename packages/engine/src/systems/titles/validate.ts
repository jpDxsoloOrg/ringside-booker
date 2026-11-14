/**
 * The checks every title command shares (CRTV1-03): the title exists, the issuer runs its
 * promotion, it is not retired; and the field checks `titles.create` and `titles.edit` share (name,
 * brand, weight range). Every reason names its subject, and `field` when a form field is at fault.
 * Messages are written for the player.
 *
 * Design: docs/design/titles.md#commands.
 */

import { controlsPromotion, type Controller } from '../../core/api/controller';
import type { Reason } from '../../core/api/result';
import type { BrandId, PromotionId, TitleId } from '../../core/ids';
import type { Title, TitleDivision } from '../../model/entities/title';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';

/** The most characters a title name may have, after trimming. */
export const TITLE_NAME_MAX_LENGTH = 60;

/** Every refusal code the title commands use besides the built-in `invalidArgs` and `notAllowed`. */
export const TITLE_COMMAND_REASON_CODES = [
  'titleNotFound',
  'promotionNotFound',
  'titleRetired',
  'brandNotInPromotion',
  'brandInactive',
  'nameLength',
  'duplicateName',
  'weightRange',
  'holderCountLocked',
  'alreadyChampion',
  'alreadyVacant',
  'notRetired',
] as const;
export type TitleCommandReasonCode = (typeof TITLE_COMMAND_REASON_CODES)[number];

/** A title found and checked, or the reasons the command stops at. */
export type TitleCheck =
  | { readonly ok: true; readonly title: DeepReadonly<Title> }
  | { readonly ok: false; readonly reasons: Reason[] };

function promotionName(read: GameWorldView, promotionId: PromotionId): string {
  return read.tables.promotions.get(promotionId)?.name ?? 'another promotion';
}

/**
 * The checks every title command starts with, stopping at the first that fails: `titleNotFound`,
 * then `notAllowed` when the issuer does not run the title's promotion, then (unless
 * `allowRetired`) `titleRetired`.
 */
export function checkTitleCommand(
  read: GameWorldView,
  titleId: TitleId,
  issuedBy: DeepReadonly<Controller>,
  options: { readonly allowRetired?: boolean } = {},
): TitleCheck {
  const title = read.tables.titles.get(titleId);
  if (title === undefined) {
    return {
      ok: false,
      reasons: [
        {
          code: 'titleNotFound',
          message: 'That title no longer exists.',
          field: 'titleId',
          subject: { kind: 'title', id: titleId },
        },
      ],
    };
  }
  const subject = { kind: 'title', id: title.id } as const;
  if (!controlsPromotion(read, title.promotionId, issuedBy)) {
    return {
      ok: false,
      reasons: [
        {
          code: 'notAllowed',
          message: `The ${title.name} belongs to ${promotionName(read, title.promotionId)}. You can only change your own titles.`,
          subject,
        },
      ],
    };
  }
  if (options.allowRetired !== true && title.status === 'retired') {
    return {
      ok: false,
      reasons: [
        {
          code: 'titleRetired',
          message: `The ${title.name} is retired. Reactivate it first.`,
          subject,
        },
      ],
    };
  }
  return { ok: true, title };
}

/** The issuer may create titles for `promotionId`: it exists and they run it. */
export function checkPromotionForCreate(
  read: GameWorldView,
  promotionId: PromotionId,
  issuedBy: DeepReadonly<Controller>,
): Reason[] {
  const promotion = read.tables.promotions.get(promotionId);
  if (promotion === undefined) {
    return [
      {
        code: 'promotionNotFound',
        message: 'That promotion no longer exists.',
        field: 'promotionId',
        subject: { kind: 'promotion', id: promotionId },
      },
    ];
  }
  if (!controlsPromotion(read, promotion.id, issuedBy)) {
    return [
      {
        code: 'notAllowed',
        message: `${promotion.name} isn't yours. You can only create titles for your own promotion.`,
        subject: { kind: 'promotion', id: promotion.id },
      },
    ];
  }
  return [];
}

/** The name with its spaces trimmed. Commands store this. */
export function cleanTitleName(name: string): string {
  return name.trim();
}

/**
 * Name checks: 1 to 60 characters after trimming (`nameLength`), and no other title of the same
 * promotion with the same name, ignoring case (`duplicateName`). `exceptTitleId` is the title
 * being renamed.
 */
export function checkTitleName(
  read: GameWorldView,
  promotionId: PromotionId,
  name: string,
  exceptTitleId: TitleId | null,
): Reason[] {
  const clean = cleanTitleName(name);
  if (clean.length === 0) {
    return [{ code: 'nameLength', message: 'Give the title a name.', field: 'name' }];
  }
  if (clean.length > TITLE_NAME_MAX_LENGTH) {
    return [
      {
        code: 'nameLength',
        message: `Title names can be up to ${String(TITLE_NAME_MAX_LENGTH)} characters.`,
        field: 'name',
      },
    ];
  }
  const lower = clean.toLowerCase();
  const clash = read.tables.titles
    .lookup('byPromotion', promotionId)
    .find((title) => title.id !== exceptTitleId && title.name.trim().toLowerCase() === lower);
  if (clash !== undefined) {
    return [
      {
        code: 'duplicateName',
        message: `${promotionName(read, promotionId)} already has a title called ${clean}.`,
        field: 'name',
        subject: { kind: 'title', id: clash.id },
      },
    ];
  }
  return [];
}

/** A brand (or null, promotion-wide) must belong to the promotion and be active. */
export function checkTitleBrand(
  read: GameWorldView,
  promotionId: PromotionId,
  brandId: BrandId | null,
): Reason[] {
  if (brandId === null) {
    return [];
  }
  const brand = read.tables.brands.get(brandId);
  if (brand?.promotionId !== promotionId) {
    return [
      {
        code: 'brandNotInPromotion',
        message: `That brand isn't part of ${promotionName(read, promotionId)}.`,
        field: 'brandId',
        subject: { kind: 'brand', id: brandId },
      },
    ];
  }
  if (!brand.active) {
    return [
      {
        code: 'brandInactive',
        message: `${brand.name} is no longer running. Pick an active brand.`,
        field: 'brandId',
        subject: { kind: 'brand', id: brand.id },
      },
    ];
  }
  return [];
}

/** The lightest limit must not be above the heaviest (`weightRange`). */
export function checkWeightRange(division: TitleDivision): Reason[] {
  const { minWeightKg, maxWeightKg } = division;
  if (minWeightKg !== null && maxWeightKg !== null && minWeightKg > maxWeightKg) {
    return [
      {
        code: 'weightRange',
        message: `The weight limit (${String(maxWeightKg)} kg) is below the minimum weight (${String(minWeightKg)} kg).`,
        field: 'division.maxWeightKg',
      },
    ];
  }
  return [];
}
