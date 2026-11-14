import { useId, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { addDays, isAfter, isBefore, isGameDate } from '@ringside/engine';
import type { GameDate } from '@ringside/engine';
import { Button } from '@/components/Button';
import { formatGameDate, formatNumber } from '@/components/format';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { Sheet } from '@/components/Sheet';
import { NewsAlertSheet } from '@/screens/news/NewsAlertSheet';
import type { AdvanceRequest } from '@/worker/engineHost';
// The sheet's own quick choices register themselves; other features add theirs the same way.
import './builtinSkipTargets';
import { useRegisteredSkipTargets, useResolvedSkipTargets } from './skipTargets';
import type { ResolvedSkipTarget, SkipTarget } from './skipTargets';
import styles from './DayControl.module.css';

export { nextMonthStart } from './builtinSkipTargets';

/** The shortest and longest skip one advance takes (the engine's `maxDays` range). */
export const MIN_SKIP_DAYS = 1;
export const MAX_SKIP_DAYS = 3650;

/** The length offered the first time, before the player has picked one. */
export const DEFAULT_SKIP_DAYS = 7;

/** The quick choice offered the first time, when it is registered. */
export const DEFAULT_SKIP_TARGET_ID = 'days.7';

/**
 * Where the last choice is remembered, per browser: a quick choice's id (`days.30`), or a typed
 * number of days (`45`). Older builds stored only numbers; those still load as a typed length.
 */
export const SKIP_LENGTH_STORAGE_KEY = 'ringside-booker.skipDays.length';

export const SKIP_LENGTH_MESSAGE = `Enter a whole number of days from ${String(MIN_SKIP_DAYS)} to ${formatNumber(MAX_SKIP_DAYS)}.`;

/** The extra stop the player can add on top of the always-on ones. */
export type ExtraStop = 'none' | 'date';

/** The words beside the news row in "Always stops". */
export const NEWS_ALERTS_STOP_LABEL = "News alerts you've turned on";

/** The skip length typed, or null when it is not a whole number in range. */
export function parseSkipLength(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days >= MIN_SKIP_DAYS && days <= MAX_SKIP_DAYS ? days : null;
}

/** The stop date typed, or a message saying what is wrong with it. */
export function checkStopDate(
  value: string,
  today: GameDate,
):
  | { readonly ok: true; readonly date: GameDate }
  | { readonly ok: false; readonly message: string } {
  if (!isGameDate(value)) return { ok: false, message: 'Pick the date to stop on.' };
  if (!isAfter(value, today)) {
    return { ok: false, message: `Pick a date after ${formatGameDate(today, 'long')}.` };
  }
  return { ok: true, date: value };
}

/** What "How long" holds: a quick choice by id, or a typed number of days. */
export type SkipLengthChoice =
  | { readonly kind: 'target'; readonly id: string }
  | { readonly kind: 'typed'; readonly text: string };

const DEFAULT_CHOICE: SkipLengthChoice = { kind: 'target', id: DEFAULT_SKIP_TARGET_ID };

/**
 * The choice stored in `SKIP_LENGTH_STORAGE_KEY`: a number is a typed length (older builds stored
 * only numbers), anything else a quick choice's id. Nothing stored (or unreadable) gives 7 days.
 */
export function parseRememberedChoice(stored: string | null): SkipLengthChoice {
  if (stored === null || stored.trim() === '') return DEFAULT_CHOICE;
  if (/^\d+$/.test(stored.trim())) {
    return parseSkipLength(stored) === null ? DEFAULT_CHOICE : { kind: 'typed', text: stored };
  }
  return { kind: 'target', id: stored };
}

function readRememberedChoice(): SkipLengthChoice {
  try {
    return parseRememberedChoice(window.localStorage.getItem(SKIP_LENGTH_STORAGE_KEY));
  } catch {
    // Storage can be blocked (private windows, site settings); the default is fine then.
    return DEFAULT_CHOICE;
  }
}

function rememberChoice(value: string): void {
  try {
    window.localStorage.setItem(SKIP_LENGTH_STORAGE_KEY, value);
  } catch {
    // Remembering is a convenience; a blocked store just means the default next time.
  }
}

/**
 * The advance to start: the chosen request, with the extra stop date added when it comes first.
 * Null while the length is not a valid number of days.
 */
export function skipRequest(
  base: AdvanceRequest | null,
  extraStopAt: GameDate | undefined,
): AdvanceRequest | null {
  if (base === null) return null;
  const stops = [base.stopAtDate, extraStopAt].filter(
    (date): date is GameDate => date !== undefined,
  );
  const [first, ...rest] = stops;
  if (first === undefined) return { maxDays: base.maxDays };
  const stopAtDate = rest.reduce(
    (earliest, date) => (isBefore(date, earliest) ? date : earliest),
    first,
  );
  return { maxDays: base.maxDays, stopAtDate };
}

/** The last day the advance can reach: `maxDays` on, or its stop date when that comes first. */
export function skipUntil(today: GameDate, request: AdvanceRequest): GameDate {
  const lastDay = addDays(today, request.maxDays);
  return request.stopAtDate !== undefined && isBefore(request.stopAtDate, lastDay)
    ? request.stopAtDate
    : lastDay;
}

export interface SkipDaysSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The current game date. */
  readonly today: GameDate;
  /** Starts the skip. The sheet closes itself after calling it. */
  readonly onStart: (request: AdvanceRequest) => void;
}

/**
 * Skip several days at once: a quick choice from the skip-target registry (`skipTargets.ts`:
 * 7, 30 and 90 days, until the 1st of next month, and whatever other features register) or a typed
 * length, and optionally a date to stop on. Shows, decisions and the news alerts the player turned
 * on always stop a skip; the sheet lists those stops so a skip that ends early is never a surprise,
 * and "Alert settings" opens the News alerts sheet on top of it.
 *
 * A side sheet on desktop and a bottom sheet on a phone.
 */
export function SkipDaysSheet(props: SkipDaysSheetProps) {
  const targets = useRegisteredSkipTargets();
  // Keyed on the registry, so a target registered later remounts the form instead of changing
  // its number of hooks.
  return <SkipDaysForm key={targetsKey(targets)} targets={targets} {...props} />;
}

function targetsKey(targets: readonly SkipTarget[]): string {
  return targets.map((target) => target.id).join('|');
}

interface SkipDaysFormProps extends SkipDaysSheetProps {
  /** The registered targets, in registration order. */
  readonly targets: readonly SkipTarget[];
}

function SkipDaysForm({ open, onClose, today, onStart, targets }: SkipDaysFormProps) {
  const resolved = useResolvedSkipTargets(targets, today);
  const [choice, setChoice] = useState<SkipLengthChoice>(readRememberedChoice);
  const [typedText, setTypedText] = useState(() =>
    choice.kind === 'typed' ? choice.text : String(DEFAULT_SKIP_DAYS),
  );
  const [extraStop, setExtraStop] = useState<ExtraStop>('none');
  const [stopDateText, setStopDateText] = useState('');
  const [lengthTouched, setLengthTouched] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  // The alerts sheet reads the engine, so it mounts the first time it is asked for.
  const [alertsWanted, setAlertsWanted] = useState(false);
  const lengthId = useId();
  const lengthErrorId = useId();
  const stopDateId = useId();
  const stopDateErrorId = useId();
  const previewId = useId();
  const formId = useId();
  const chipDetailId = useId();

  // A remembered choice whose chip is hidden today falls back to the typed length.
  const chosenTarget: ResolvedSkipTarget | undefined =
    choice.kind === 'target' ? resolved.find((entry) => entry.target.id === choice.id) : undefined;
  const lengthText =
    chosenTarget === undefined ? typedText : String(chosenTarget.choice.request.maxDays);
  const typedDays = parseSkipLength(typedText);
  const base: AdvanceRequest | null =
    chosenTarget !== undefined
      ? chosenTarget.choice.request
      : typedDays === null
        ? null
        : { maxDays: typedDays };

  const stopDateCheck = checkStopDate(stopDateText, today);
  const extraStopAt = extraStop === 'date' && stopDateCheck.ok ? stopDateCheck.date : undefined;
  const request = skipRequest(base, extraStopAt);
  const stopReady = extraStop !== 'date' || stopDateCheck.ok;
  const showLengthError = base === null && (lengthTouched || typedText.trim() !== '');
  const stopDateError =
    extraStop === 'date' && stopDateText !== '' && !stopDateCheck.ok ? stopDateCheck.message : null;
  const until = request === null ? null : skipUntil(today, request);
  const canStart = request !== null && stopReady;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLengthTouched(true);
    if (request === null || !stopReady) return;
    rememberChoice(chosenTarget === undefined ? String(request.maxDays) : chosenTarget.target.id);
    onStart(request);
    onClose();
  };

  const stopOptions: readonly RadioOption<ExtraStop>[] = [
    { value: 'none', label: 'No extra stop' },
    { value: 'date', label: 'Stop on a date' },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Skip days"
      side="right"
      size="sm"
      footer={
        <div className={styles['sheetFooter']}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            iconStart="fast-forward"
            disabled={!canStart}
          >
            Start
          </Button>
        </div>
      }
    >
      <form id={formId} className={styles['skipForm']} onSubmit={handleSubmit} noValidate>
        <fieldset className={styles['fieldset']}>
          <legend className={styles['fieldLabel']}>How long</legend>
          <div className={styles['quickChips']}>
            {resolved.map(({ target, choice: targetChoice }, index) => {
              const detailId = `${chipDetailId}-${String(index)}`;
              return (
                <button
                  key={target.id}
                  type="button"
                  className={styles['quickChip']}
                  aria-pressed={chosenTarget?.target.id === target.id}
                  aria-describedby={detailId}
                  data-target-id={target.id}
                  onClick={() => {
                    setChoice({ kind: 'target', id: target.id });
                  }}
                >
                  <span className={styles['quickChipLabel']}>{target.label}</span>
                  <span id={detailId} className={styles['quickChipDetail']} aria-hidden="true">
                    {targetChoice.detail}
                  </span>
                </button>
              );
            })}
          </div>
          <label htmlFor={lengthId} className={styles['fieldLabel']}>
            Days to skip
          </label>
          <input
            id={lengthId}
            className={styles['textInput']}
            type="number"
            inputMode="numeric"
            min={MIN_SKIP_DAYS}
            max={MAX_SKIP_DAYS}
            step={1}
            value={lengthText}
            aria-invalid={showLengthError}
            aria-describedby={showLengthError ? `${lengthErrorId} ${previewId}` : previewId}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setTypedText(event.target.value);
              setChoice({ kind: 'typed', text: event.target.value });
            }}
            onBlur={() => {
              setLengthTouched(true);
            }}
          />
          {showLengthError && (
            <p id={lengthErrorId} className={styles['fieldError']} role="alert">
              {SKIP_LENGTH_MESSAGE}
            </p>
          )}
          <p id={previewId} className={styles['preview']} aria-live="polite">
            {until === null ? 'Until —' : `Until ${formatGameDate(until, 'long')}`}
          </p>
        </fieldset>

        <fieldset className={styles['fieldset']}>
          <legend className={styles['fieldLabel']}>Always stops</legend>
          <p className={styles['fieldHint']}>
            A skip always stops for your own shows and for decisions only you can make, so these
            can&apos;t be turned off. It also stops for the news alerts you&apos;ve turned on.
          </p>
          <label className={styles['checkRow']}>
            <input type="checkbox" className={styles['checkbox']} checked disabled readOnly />
            Stop at my shows
          </label>
          <label className={styles['checkRow']}>
            <input type="checkbox" className={styles['checkbox']} checked disabled readOnly />
            Stop when a decision arrives
          </label>
          <div className={styles['stopRow']}>
            <label className={styles['checkRow']}>
              <input type="checkbox" className={styles['checkbox']} checked disabled readOnly />
              {NEWS_ALERTS_STOP_LABEL}
            </label>
            <button
              type="button"
              className={styles['linkButton']}
              aria-haspopup="dialog"
              onClick={() => {
                setAlertsWanted(true);
                setAlertsOpen(true);
              }}
            >
              Alert settings
            </button>
          </div>
        </fieldset>

        <RadioGroup
          legend="Also stop"
          options={stopOptions}
          value={extraStop}
          onValueChange={setExtraStop}
        />
        {extraStop === 'date' && (
          <div className={styles['field']}>
            <label htmlFor={stopDateId} className={styles['fieldLabel']}>
              Stop on
            </label>
            <input
              id={stopDateId}
              className={styles['textInput']}
              type="date"
              min={addDays(today, 1)}
              value={stopDateText}
              aria-invalid={stopDateError !== null}
              aria-describedby={stopDateError === null ? undefined : stopDateErrorId}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setStopDateText(event.target.value);
              }}
            />
            {stopDateError !== null && (
              <p id={stopDateErrorId} className={styles['fieldError']} role="alert">
                {stopDateError}
              </p>
            )}
          </div>
        )}
      </form>
      {alertsWanted && (
        <NewsAlertSheet
          open={alertsOpen}
          onClose={() => {
            setAlertsOpen(false);
          }}
        />
      )}
    </Sheet>
  );
}
