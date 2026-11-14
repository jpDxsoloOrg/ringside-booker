import { isId, TITLE_NAME_MAX_LENGTH } from '@ringside/engine';
import type {
  BrandId,
  DivisionGender,
  PromotionId,
  Reason,
  TitleCardRow,
  TitleCreateArgs,
  TitleEditArgs,
  TitleHolderCount,
  TitleId,
  TitleTier,
} from '@ringside/engine';

/** The brand choice that means "no brand": the title belongs to the whole promotion. */
export const PROMOTION_WIDE_VALUE = 'promotion-wide';

/** The word for a promotion-wide title in the brand choice. */
export const PROMOTION_WIDE_LABEL = 'Promotion-wide';

/** Shown under the holders choice while the title has a champion. */
export const HOLDERS_LOCKED_HINT = 'Vacate the title to change this';

/** A colour the form offers: a name the player reads and the `#rrggbb` the title stores. */
export interface TitleColorSwatch {
  readonly name: string;
  readonly hex: string;
}

/** The eight colours the form offers for the placeholder belt. Gold first, the usual choice. */
export const TITLE_COLOR_SWATCHES: readonly TitleColorSwatch[] = [
  { name: 'Gold', hex: '#c9a227' },
  { name: 'Silver', hex: '#8a8d91' },
  { name: 'Bronze', hex: '#b0703a' },
  { name: 'Red', hex: '#b91c1c' },
  { name: 'Blue', hex: '#1d4ed8' },
  { name: 'Green', hex: '#15803d' },
  { name: 'Purple', hex: '#7e22ce' },
  { name: 'Black', hex: '#1f2328' },
];

/** The holder counts in the order the form offers them, with their words. */
export const HOLDER_COUNT_CHOICES: readonly { value: TitleHolderCount; label: string }[] = [
  { value: 1, label: 'Singles' },
  { value: 2, label: 'Tag team' },
  { value: 3, label: 'Trios' },
];

/** The division genders in the order the form offers them, with their words. */
export const DIVISION_CHOICES: readonly { value: DivisionGender; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'male', label: "Men's" },
  { value: 'female', label: "Women's" },
];

/** The tiers the create form offers, each with a one-line hint. */
export const TIER_CHOICES: readonly { value: TitleTier; label: string; hint: string }[] = [
  { value: 'world', label: 'World', hint: 'The top prize. Starts with the most prestige.' },
  {
    value: 'secondary',
    label: 'Secondary',
    hint: 'The next rung down, such as a mid-card title.',
  },
  {
    value: 'specialty',
    label: 'Specialty',
    hint: 'A belt for a style or gimmick. Starts with the least prestige.',
  },
];

/** What the form holds while the player fills it in. Weights stay text until submit. */
export interface TitleFormValues {
  readonly name: string;
  /** A brand id, or {@link PROMOTION_WIDE_VALUE}. */
  readonly brand: string;
  readonly holderCount: TitleHolderCount;
  readonly gender: DivisionGender;
  readonly minWeight: string;
  readonly maxWeight: string;
  readonly color: string;
  readonly tier: TitleTier;
}

/** A new title: singles, open, promotion-wide unless a brand is given, gold, secondary. */
export function emptyTitleForm(brandId: BrandId | null = null): TitleFormValues {
  return {
    name: '',
    brand: brandId ?? PROMOTION_WIDE_VALUE,
    holderCount: 1,
    gender: 'open',
    minWeight: '',
    maxWeight: '',
    color: TITLE_COLOR_SWATCHES[0]?.hex ?? '#c9a227',
    tier: 'secondary',
  };
}

/** A weight shown in the form: rounded to a whole kilogram, empty for no limit. */
export function weightText(kg: number | null): string {
  return kg === null ? '' : String(Math.round(kg));
}

/** The form filled in from a title's row, for editing. */
export function titleFormFromRow(
  row: Pick<TitleCardRow, 'name' | 'brandId' | 'holderCount' | 'division' | 'color'>,
): TitleFormValues {
  return {
    name: row.name,
    brand: row.brandId ?? PROMOTION_WIDE_VALUE,
    holderCount: row.holderCount,
    gender: row.division.gender,
    minWeight: weightText(row.division.minWeightKg),
    maxWeight: weightText(row.division.maxWeightKg),
    color: row.color.toLowerCase(),
    // Not stored on a title, and not offered when editing.
    tier: 'secondary',
  };
}

/** The form's field names that can carry an error under them. */
export type TitleFormField =
  'name' | 'brand' | 'holderCount' | 'division' | 'minWeight' | 'maxWeight';

/** The problems found with the form: one per field, and the rest for the top of the sheet. */
export interface TitleFormErrors {
  readonly fields: Partial<Record<TitleFormField, string>>;
  readonly general: readonly string[];
}

export const NO_FORM_ERRORS: TitleFormErrors = { fields: {}, general: [] };

/** The engine's reason fields and the form fields they belong under. */
const FIELD_BY_REASON_FIELD: Readonly<Record<string, TitleFormField>> = {
  name: 'name',
  brandId: 'brand',
  holderCount: 'holderCount',
  division: 'division',
  'division.gender': 'division',
  'division.minWeightKg': 'minWeight',
  'division.maxWeightKg': 'maxWeight',
};

/**
 * The engine's reasons, each under the field it names, word for word. Several reasons on one
 * field are joined; a reason with no field (or one the form has no place for) goes to the top.
 */
export function formErrorsFromReasons(reasons: readonly Reason[]): TitleFormErrors {
  const fields: Partial<Record<TitleFormField, string>> = {};
  const general: string[] = [];
  for (const reason of reasons) {
    const field = reason.field === undefined ? undefined : FIELD_BY_REASON_FIELD[reason.field];
    if (field === undefined) {
      general.push(reason.message);
      continue;
    }
    const before = fields[field];
    fields[field] = before === undefined ? reason.message : `${before} ${reason.message}`;
  }
  return { fields, general };
}

/** The text of a weight box as kilograms: null when empty, undefined when it is not a weight. */
export function parseWeight(text: string): number | null | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const kg = Number(trimmed);
  return Number.isFinite(kg) && kg > 0 ? kg : undefined;
}

/** The message under a weight box the form can't read. */
export const WEIGHT_NOT_A_NUMBER = 'Enter a weight in kg, or leave it empty for no limit.';

/** The division the form describes, or the field errors that stop it being sent. */
export function divisionFromForm(values: TitleFormValues):
  | {
      readonly ok: true;
      readonly division: {
        gender: DivisionGender;
        minWeightKg: number | null;
        maxWeightKg: number | null;
      };
    }
  | { readonly ok: false; readonly errors: TitleFormErrors } {
  const minWeightKg = parseWeight(values.minWeight);
  const maxWeightKg = parseWeight(values.maxWeight);
  if (minWeightKg === undefined || maxWeightKg === undefined) {
    return {
      ok: false,
      errors: {
        fields: {
          ...(minWeightKg === undefined ? { minWeight: WEIGHT_NOT_A_NUMBER } : {}),
          ...(maxWeightKg === undefined ? { maxWeight: WEIGHT_NOT_A_NUMBER } : {}),
        },
        general: [],
      },
    };
  }
  return { ok: true, division: { gender: values.gender, minWeightKg, maxWeightKg } };
}

/** The brand choice as the commands want it. */
export function brandIdFromForm(values: TitleFormValues): BrandId | null {
  return isId('brand', values.brand) ? values.brand : null;
}

/** `titles.create`'s arguments, or the errors that stop the form being sent. */
export function createArgsFromForm(
  promotionId: PromotionId,
  values: TitleFormValues,
):
  | { readonly ok: true; readonly args: TitleCreateArgs }
  | { readonly ok: false; readonly errors: TitleFormErrors } {
  const division = divisionFromForm(values);
  if (!division.ok) return division;
  return {
    ok: true,
    args: {
      promotionId,
      brandId: brandIdFromForm(values),
      name: values.name,
      holderCount: values.holderCount,
      division: division.division,
      tier: values.tier,
      color: values.color,
    },
  };
}

/**
 * `titles.edit`'s arguments: the name, brand, division and colour as the form has them, and the
 * holder count only when it changed (the engine refuses any change while the title is held).
 * Weights the player left as shown keep their exact stored value rather than the rounded one.
 */
export function editArgsFromForm(
  row: Pick<TitleCardRow, 'titleId' | 'division' | 'holderCount'>,
  values: TitleFormValues,
):
  | { readonly ok: true; readonly args: TitleEditArgs }
  | { readonly ok: false; readonly errors: TitleFormErrors } {
  const division = divisionFromForm(values);
  if (!division.ok) return division;
  const stored = row.division;
  const minWeightKg =
    values.minWeight === weightText(stored.minWeightKg)
      ? stored.minWeightKg
      : division.division.minWeightKg;
  const maxWeightKg =
    values.maxWeight === weightText(stored.maxWeightKg)
      ? stored.maxWeightKg
      : division.division.maxWeightKg;
  const titleId: TitleId = row.titleId;
  return {
    ok: true,
    args: {
      titleId,
      name: values.name,
      brandId: brandIdFromForm(values),
      division: { gender: values.gender, minWeightKg, maxWeightKg },
      color: values.color,
      ...(values.holderCount === row.holderCount ? {} : { holderCount: values.holderCount }),
    },
  };
}

/** The most characters the name box takes, as the engine allows. */
export const TITLE_NAME_MAX = TITLE_NAME_MAX_LENGTH;
