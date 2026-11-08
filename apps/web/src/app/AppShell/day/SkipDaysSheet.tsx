import { useId, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { addDays, addMonths, isAfter, isBefore, isGameDate, startOfMonth } from '@ringside/engine';
import type { GameDate } from '@ringside/engine';
import { Button } from '@/components/Button';
import { formatGameDate, formatNumber } from '@/components/format';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { Sheet } from '@/components/Sheet';
import type { AdvanceRequest } from '@/worker/engineHost';
import { dayCount } from './advanceSummaryText';
import styles from './DayControl.module.css';

/** The quick choices, in days. */
export const QUICK_SKIP_LENGTHS: readonly number[] = [7, 14, 30, 90, 180, 365];

/** The shortest and longest skip one advance takes (the engine's `maxDays` range). */
export const MIN_SKIP_DAYS = 1;
export const MAX_SKIP_DAYS = 3650;

/** The length offered the first time, before the player has picked one. */
export const DEFAULT_SKIP_DAYS = 7;

/** Where the last-used length is remembered, per browser. */
export const SKIP_LENGTH_STORAGE_KEY = 'ringside-booker.skipDays.length';

export const SKIP_LENGTH_MESSAGE = `Enter a whole number of days from ${String(MIN_SKIP_DAYS)} to ${formatNumber(MAX_SKIP_DAYS)}.`;

/** The extra stop the player can add on top of the always-on ones. */
export type ExtraStop = 'none' | 'nextMonth' | 'date';

/** The skip length typed, or null when it is not a whole number in range. */
export function parseSkipLength(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days >= MIN_SKIP_DAYS && days <= MAX_SKIP_DAYS ? days : null;
}

/** The first day of the month after `today`: 31 January gives 1 February. */
export function nextMonthStart(today: GameDate): GameDate {
  return startOfMonth(addMonths(today, 1));
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

function readRememberedLength(): string {
  try {
    const stored = window.localStorage.getItem(SKIP_LENGTH_STORAGE_KEY);
    if (stored !== null && parseSkipLength(stored) !== null) return stored;
  } catch {
    // Storage can be blocked (private windows, site settings); the default is fine then.
  }
  return String(DEFAULT_SKIP_DAYS);
}

function rememberLength(days: number): void {
  try {
    window.localStorage.setItem(SKIP_LENGTH_STORAGE_KEY, String(days));
  } catch {
    // Remembering is a convenience; a blocked store just means the default next time.
  }
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
 * Skip several days at once: a quick length or a typed one, and optionally an extra stop (the
 * start of next month, or a date). Shows and decisions always stop a skip; the sheet shows those
 * stops ticked and locked so a skip that ends early is never a surprise.
 *
 * A side sheet on desktop and a bottom sheet on a phone.
 */
export function SkipDaysSheet({ open, onClose, today, onStart }: SkipDaysSheetProps) {
  const [lengthText, setLengthText] = useState(readRememberedLength);
  const [extraStop, setExtraStop] = useState<ExtraStop>('none');
  const [stopDateText, setStopDateText] = useState('');
  const [lengthTouched, setLengthTouched] = useState(false);
  const lengthId = useId();
  const lengthErrorId = useId();
  const stopDateId = useId();
  const stopDateErrorId = useId();
  const previewId = useId();
  const formId = useId();

  const maxDays = parseSkipLength(lengthText);
  const stopDateCheck = checkStopDate(stopDateText, today);
  let stopAtDate: GameDate | undefined;
  if (extraStop === 'nextMonth') stopAtDate = nextMonthStart(today);
  if (extraStop === 'date' && stopDateCheck.ok) stopAtDate = stopDateCheck.date;
  const stopReady = extraStop !== 'date' || stopDateCheck.ok;
  const showLengthError = maxDays === null && (lengthTouched || lengthText.trim() !== '');
  const stopDateError =
    extraStop === 'date' && stopDateText !== '' && !stopDateCheck.ok ? stopDateCheck.message : null;

  let until: GameDate | null = null;
  if (maxDays !== null) {
    const lastDay = addDays(today, maxDays);
    until = stopAtDate !== undefined && isBefore(stopAtDate, lastDay) ? stopAtDate : lastDay;
  }

  const canStart = maxDays !== null && stopReady;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLengthTouched(true);
    if (maxDays === null || !stopReady) return;
    rememberLength(maxDays);
    onStart(stopAtDate === undefined ? { maxDays } : { maxDays, stopAtDate });
    onClose();
  };

  const stopOptions: readonly RadioOption<ExtraStop>[] = [
    { value: 'none', label: 'No extra stop' },
    {
      value: 'nextMonth',
      label: 'Stop at the start of next month',
      description: formatGameDate(nextMonthStart(today), 'long'),
    },
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
            {QUICK_SKIP_LENGTHS.map((days) => (
              <button
                key={days}
                type="button"
                className={styles['quickChip']}
                aria-pressed={maxDays === days}
                onClick={() => {
                  setLengthText(String(days));
                }}
              >
                {dayCount(days)}
              </button>
            ))}
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
              setLengthText(event.target.value);
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
            can&apos;t be turned off.
          </p>
          <label className={styles['checkRow']}>
            <input type="checkbox" className={styles['checkbox']} checked disabled readOnly />
            Stop at my shows
          </label>
          <label className={styles['checkRow']}>
            <input type="checkbox" className={styles['checkbox']} checked disabled readOnly />
            Stop when a decision arrives
          </label>
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
    </Sheet>
  );
}
