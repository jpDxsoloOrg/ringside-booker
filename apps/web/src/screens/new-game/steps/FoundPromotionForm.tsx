import { useId } from 'react';
import { cents, FOUNDING_SIZES, HEX_COLOR_PATTERN, PROMOTION_STYLES } from '@ringside/engine';
import type { PromotionStyle, Weekday, WorldPreview } from '@ringside/engine';
import { classNames } from '@/components/classNames';
import { formatNumber, useMoneyFormatter } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { RadioGroup } from '@/components/RadioGroup';
import { Select } from '@/components/Select';
import { Switch } from '@/components/Switch';
import { FieldError, TextField } from '../fields/Fields';
import type { WizardIssue } from '../issues';
import { fieldMessage } from '../issues';
import { codeLabel, WEEKDAY_LABELS, WEEKDAYS } from '../labels';
import {
  FOUNDED_NAME_MAX,
  normaliseShortName,
  promotionNameProblem,
  shortNameProblem,
} from '../draftModel';
import type { FoundFormValues } from '../useNewGameDraft';
import styles from './Steps.module.css';

export interface FoundPromotionFormProps {
  readonly preview: WorldPreview;
  readonly values: FoundFormValues;
  /** Problems from Next or from the engine, by field. */
  readonly issues: readonly WizardIssue[];
  readonly onChange: (changes: Partial<FoundFormValues>) => void;
}

/** The ImageSlot id a founded promotion's placeholder logo is seeded from, before it has an ID. */
export function foundedLogoId(shortName: string): string {
  return `founded-${normaliseShortName(shortName) || 'new'}`;
}

function isPromotionStyle(value: string): value is PromotionStyle {
  return PROMOTION_STYLES.some((style) => style === value);
}

function weekdayFrom(value: string): Weekday | null {
  return WEEKDAYS.find((day) => String(day) === value) ?? null;
}

/**
 * The form for founding a promotion: names, a home region, a style, a size whose cash and
 * popularity come from the engine's preview, a colour, and the starter kit. The short name is
 * checked against the names already taken as it is typed, so a clash shows before Next.
 */
export function FoundPromotionForm({ preview, values, issues, onChange }: FoundPromotionFormProps) {
  const formatMoney = useMoneyFormatter();
  const colourPickerId = useId();
  const regionErrorId = useId();

  // Live checks once something is typed; the step's checks (on Next) cover empty fields.
  const nameLive = values.name === '' ? null : promotionNameProblem(values.name, preview);
  const shortLive = values.shortName === '' ? null : shortNameProblem(values.shortName, preview);
  const nameError = nameLive ?? fieldMessage(issues, 'name');
  const shortNameError = shortLive ?? fieldMessage(issues, 'shortName');
  const colourValid = HEX_COLOR_PATTERN.test(values.color);
  const colourError = colourValid
    ? fieldMessage(issues, 'color')
    : 'Use a hex colour such as #1a2b3c.';

  const continent = preview.regions.find((row) => row.key === values.continentKey);
  const country = continent?.countries.find((row) => row.key === values.countryKey);

  const sizeOptions = FOUNDING_SIZES.map((size) => {
    const numbers = preview.foundingSizes[size];
    return {
      value: size,
      label: codeLabel(size),
      description: `${formatMoney(cents(numbers.cash))} cash · popularity ${formatNumber(
        numbers.homePopularity,
      )} at home, ${formatNumber(numbers.countryPopularity)} in the rest of the country · prestige ${formatNumber(numbers.prestige)}`,
    };
  });

  return (
    <div className={styles['formGrid']}>
      <TextField
        label="Promotion name"
        value={values.name}
        onValueChange={(name) => {
          onChange({ name });
        }}
        maxLength={FOUNDED_NAME_MAX}
        autoComplete="off"
        error={nameError}
      />
      <TextField
        label="Short name"
        value={values.shortName}
        onValueChange={(shortName) => {
          onChange({ shortName });
        }}
        uppercase
        maxLength={8}
        autoComplete="off"
        spellCheck={false}
        hint="2 to 8 letters or digits, shown in capitals."
        error={shortNameError}
      />

      <fieldset
        className={classNames(styles['regionPicker'], styles['fullRow'])}
        aria-describedby={
          fieldMessage(issues, 'homeRegionKey') === undefined ? undefined : regionErrorId
        }
      >
        <legend>Home region</legend>
        <Select
          label="Continent"
          placeholder="Choose a continent"
          value={values.continentKey}
          options={preview.regions.map((row) => ({ value: row.key, label: row.name }))}
          onValueChange={(continentKey) => {
            onChange({ continentKey, countryKey: '', homeRegionKey: '' });
          }}
        />
        <Select
          label="Country"
          placeholder={continent === undefined ? 'Choose a continent first' : 'Choose a country'}
          disabled={continent === undefined}
          value={values.countryKey}
          options={(continent?.countries ?? []).map((row) => ({ value: row.key, label: row.name }))}
          onValueChange={(countryKey) => {
            onChange({ countryKey, homeRegionKey: '' });
          }}
        />
        <Select
          label="Region"
          placeholder={country === undefined ? 'Choose a country first' : 'Choose a region'}
          disabled={country === undefined}
          value={values.homeRegionKey}
          options={(country?.regions ?? []).map((row) => ({ value: row.key, label: row.name }))}
          onValueChange={(homeRegionKey) => {
            onChange({ homeRegionKey });
          }}
        />
        <div className={styles['regionError']}>
          <FieldError id={regionErrorId} message={fieldMessage(issues, 'homeRegionKey')} />
        </div>
      </fieldset>

      <div>
        <Select
          label="Style"
          placeholder="Choose a style"
          value={values.style ?? ''}
          options={PROMOTION_STYLES.map((style) => ({ value: style, label: codeLabel(style) }))}
          onValueChange={(style) => {
            if (isPromotionStyle(style)) onChange({ style });
          }}
        />
        <FieldError id={`${regionErrorId}-style`} message={fieldMessage(issues, 'style')} />
      </div>

      <div className={styles['colourRow']}>
        <div className={styles['colourPickerField']}>
          <label htmlFor={colourPickerId} className={styles['label']}>
            Promotion colour
          </label>
          <input
            id={colourPickerId}
            type="color"
            value={colourValid ? values.color.toLowerCase() : '#000000'}
            onChange={(event) => {
              onChange({ color: event.target.value });
            }}
            className={styles['colourPicker']}
          />
        </div>
        <TextField
          label="Colour hex code"
          value={values.color}
          onValueChange={(color) => {
            onChange({ color: color.trim() });
          }}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          className={styles['colourHex']}
          error={colourError}
        />
        <div className={styles['logoPreview']}>
          <ImageSlot
            subject={{
              kind: 'promotion',
              id: foundedLogoId(values.shortName),
              name: values.name.trim() === '' ? 'Your promotion' : values.name.trim(),
              shortName: normaliseShortName(values.shortName),
            }}
            size="md"
          />
          {colourValid && (
            <svg
              className={styles['swatch']}
              viewBox="0 0 40 40"
              role="img"
              aria-label={`Colour ${values.color.toLowerCase()}`}
            >
              <rect width="40" height="40" fill={values.color} />
            </svg>
          )}
        </div>
      </div>

      <div className={styles['fullRow']}>
        <RadioGroup
          legend="Size"
          description="How much you start with. Bigger means more cash and a head start with the fans."
          layout="row"
          options={sizeOptions}
          value={values.size}
          onValueChange={(size) => {
            onChange({ size });
          }}
        />
      </div>

      <div className={styles['fullRow']}>
        <Switch
          label="Starter kit"
          description="A vacant championship and a weekly show, so you have something to book from day one."
          checked={values.starterKit}
          onCheckedChange={(starterKit) => {
            onChange({ starterKit });
          }}
        />
      </div>
      {values.starterKit && (
        <Select
          label="Weekly show day"
          value={String(values.weeklyShowDay)}
          options={WEEKDAYS.map((day) => ({ value: String(day), label: WEEKDAY_LABELS[day] }))}
          onValueChange={(value) => {
            const weeklyShowDay = weekdayFrom(value);
            if (weeklyShowDay !== null) onChange({ weeklyShowDay });
          }}
        />
      )}
    </div>
  );
}
