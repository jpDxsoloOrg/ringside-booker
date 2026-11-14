import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { DivisionGender, TitleHolderCount, TitleTier } from '@ringside/engine';
import { Button } from '@/components/Button';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Sheet } from '@/components/Sheet';
import { FieldError, TextField } from '@/components/TextField';
import {
  DIVISION_CHOICES,
  HOLDER_COUNT_CHOICES,
  HOLDERS_LOCKED_HINT,
  PROMOTION_WIDE_LABEL,
  PROMOTION_WIDE_VALUE,
  TIER_CHOICES,
  TITLE_COLOR_SWATCHES,
  TITLE_NAME_MAX,
} from './titleForm';
import type { TitleFormErrors, TitleFormValues } from './titleForm';
import styles from './TitleActions.module.css';

/** A brand the form offers: the promotion's running brands, by priority. */
export interface TitleFormBrand {
  readonly brandId: string;
  readonly name: string;
}

export type TitleFormMode = 'create' | 'edit';

export interface TitleFormSheetProps {
  readonly open: boolean;
  readonly mode: TitleFormMode;
  /** What the form starts with each time it opens. */
  readonly initial: TitleFormValues;
  /** The brands to offer besides "Promotion-wide". */
  readonly brands: readonly TitleFormBrand[];
  /** Edit mode: the title's name for the heading. */
  readonly titleName?: string;
  /** Edit mode: true while the title has a champion, which locks the holders choice. */
  readonly held?: boolean;
  /** True while the command is on its way: Save can't be pressed again. */
  readonly pending: boolean;
  /** The engine's refusal (or the form's own check), under the fields it names. */
  readonly errors: TitleFormErrors;
  readonly onSubmit: (values: TitleFormValues) => void;
  readonly onClose: () => void;
}

/** A belt colour's little sample. Drawn as SVG so the stored colour needs no inline style. */
function ColorSample({ hex }: { readonly hex: string }) {
  return (
    <svg className={styles['swatch']} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="22" height="22" rx="4" fill={hex} />
    </svg>
  );
}

/** The colour choice: the eight swatches, and the title's own colour first when it is another. */
function colorOptions(current: string): readonly RadioOption<string>[] {
  const swatches = TITLE_COLOR_SWATCHES.map((swatch) => ({
    value: swatch.hex,
    label: swatch.name,
    preview: <ColorSample hex={swatch.hex} />,
  }));
  const known = TITLE_COLOR_SWATCHES.some((swatch) => swatch.hex === current.toLowerCase());
  return known
    ? swatches
    : [
        { value: current, label: 'Current colour', preview: <ColorSample hex={current} /> },
        ...swatches,
      ];
}

/** The holders choice's radio values. */
type HolderChoice = 'singles' | 'tag' | 'trios';

const HOLDER_CHOICE_BY_COUNT: Readonly<Record<TitleHolderCount, HolderChoice>> = {
  1: 'singles',
  2: 'tag',
  3: 'trios',
};

const HOLDER_OPTIONS: readonly RadioOption<HolderChoice>[] = HOLDER_COUNT_CHOICES.map((choice) => ({
  value: HOLDER_CHOICE_BY_COUNT[choice.value],
  label: choice.label,
}));

function holderCountOf(value: HolderChoice): TitleHolderCount {
  return (
    HOLDER_COUNT_CHOICES.find((choice) => HOLDER_CHOICE_BY_COUNT[choice.value] === value)?.value ??
    1
  );
}

const DIVISION_OPTIONS: readonly RadioOption<DivisionGender>[] = DIVISION_CHOICES.map((choice) => ({
  value: choice.value,
  label: choice.label,
}));

const TIER_OPTIONS: readonly RadioOption<TitleTier>[] = TIER_CHOICES.map((choice) => ({
  value: choice.value,
  label: choice.label,
  description: choice.hint,
}));

/** The sheet's id for its form, so the Save button in the footer can submit it. */
const FORM_ID = 'title-form';

/**
 * Create a title, or edit one: name, brand (or promotion-wide), how many hold it, the division and
 * its weight limits, the belt colour and, when creating, the tier that sets its starting prestige.
 * A side sheet on desktop, a bottom sheet on a phone, fields in one column. It only gathers the
 * choices: the screen sends them, and puts the engine's refusals back under the fields they name
 * (the rest at the top). Holders are locked in edit mode while the title has a champion.
 */
export function TitleFormSheet({
  open,
  mode,
  initial,
  brands,
  titleName,
  held = false,
  pending,
  errors,
  onSubmit,
  onClose,
}: TitleFormSheetProps) {
  const errorIdPrefix = useId();
  const [values, setValues] = useState<TitleFormValues>(initial);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValues(initial);
  }
  const change = (patch: Partial<TitleFormValues>): void => {
    setValues((current) => ({ ...current, ...patch }));
  };

  const brandOptions: readonly SelectOption[] = [
    ...brands.map((brand) => ({ value: brand.brandId, label: brand.name })),
    { value: PROMOTION_WIDE_VALUE, label: PROMOTION_WIDE_LABEL },
  ];
  const holdersLocked = mode === 'edit' && held;
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!pending) onSubmit(values);
  };
  const heading = mode === 'create' ? 'New title' : `Edit ${titleName ?? 'title'}`;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={heading}
      side="right"
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={pending}>
            {mode === 'create' ? 'Create title' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className={styles['form']} onSubmit={submit} noValidate>
        {errors.general.length > 0 && (
          <div className={styles['refusal']} role="alert">
            {errors.general.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
        <TextField
          label="Name"
          value={values.name}
          onValueChange={(name) => {
            change({ name });
          }}
          maxLength={TITLE_NAME_MAX}
          autoComplete="off"
          hint={`Up to ${String(TITLE_NAME_MAX)} characters.`}
          error={errors.fields.name}
        />
        <div>
          <Select
            label="Brand"
            options={brandOptions}
            value={values.brand}
            onValueChange={(brand) => {
              change({ brand });
            }}
          />
          <FieldError id={`${errorIdPrefix}-brand`} message={errors.fields.brand} />
        </div>
        <div>
          <RadioGroup
            legend="Holders"
            layout="row"
            options={HOLDER_OPTIONS}
            value={HOLDER_CHOICE_BY_COUNT[values.holderCount]}
            onValueChange={(value) => {
              change({ holderCount: holderCountOf(value) });
            }}
            disabled={holdersLocked}
            {...(holdersLocked ? { description: HOLDERS_LOCKED_HINT } : {})}
          />
          <FieldError id={`${errorIdPrefix}-holders`} message={errors.fields.holderCount} />
        </div>
        <div>
          <RadioGroup
            legend="Division"
            layout="row"
            options={DIVISION_OPTIONS}
            value={values.gender}
            onValueChange={(gender) => {
              change({ gender });
            }}
          />
          <FieldError id={`${errorIdPrefix}-division`} message={errors.fields.division} />
        </div>
        <div className={styles['weights']}>
          <TextField
            label="Minimum weight (kg)"
            value={values.minWeight}
            onValueChange={(minWeight) => {
              change({ minWeight });
            }}
            inputMode="decimal"
            autoComplete="off"
            hint="Optional."
            error={errors.fields.minWeight}
          />
          <TextField
            label="Weight limit (kg)"
            value={values.maxWeight}
            onValueChange={(maxWeight) => {
              change({ maxWeight });
            }}
            inputMode="decimal"
            autoComplete="off"
            hint="Optional."
            error={errors.fields.maxWeight}
          />
        </div>
        <RadioGroup
          legend="Colour"
          layout="row"
          options={colorOptions(initial.color)}
          value={values.color}
          onValueChange={(color) => {
            change({ color });
          }}
        />
        {mode === 'create' && (
          <RadioGroup
            legend="Tier"
            description="Sets the starting prestige. The title's Why? explains it once it exists."
            options={TIER_OPTIONS}
            value={values.tier}
            onValueChange={(tier) => {
              change({ tier });
            }}
          />
        )}
      </form>
    </Sheet>
  );
}
