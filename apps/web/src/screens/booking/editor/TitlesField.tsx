import { useId } from 'react';
import type { BookingTitleOption, SegmentDraft, TitleId } from '@ringside/engine';
import { ImageSlot } from '@/components/ImageSlot';
import { namesText } from './editorText';
import styles from './SegmentEditor.module.css';

/**
 * "Add the champion, Rhea Cortez, to a side" when a title on the line has a holder who isn't
 * competing, else null. A heads-up only: the engine's `championMissing` check is the authority.
 */
export function championMissingText(
  option: BookingTitleOption,
  draft: SegmentDraft,
): string | null {
  const competing = new Set(
    draft.participants
      .filter((person) => person.role === 'competitor')
      .map((person) => person.personId),
  );
  const missing = option.holderIds.flatMap((personId, index) =>
    competing.has(personId) ? [] : [option.holderNames[index] ?? 'the champion'],
  );
  if (missing.length === 0) return null;
  return missing.length === 1
    ? `Add the champion, ${namesText(missing)}, to a side`
    : `Add the champions, ${namesText(missing)}, to a side`;
}

export interface TitlesFieldProps {
  readonly draft: SegmentDraft;
  readonly options: readonly BookingTitleOption[];
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly onChange: (titleIds: readonly TitleId[]) => void;
}

/**
 * Titles on the line: a checkbox per active title of the promotion with its belt, its holders or
 * "Vacant", and a note when it belongs to another brand or its champion isn't in the match.
 */
export function TitlesField({ draft, options, disabled, invalid, onChange }: TitlesFieldProps) {
  const idPrefix = useId();
  if (draft.kind !== 'match') return null;
  const chosen = draft.match.titleIds;
  // A title booked earlier that is no longer offered (retired, say) still shows so it can be taken off.
  const offered = new Set(options.map((option) => option.titleId));
  const stale = chosen.filter((titleId) => !offered.has(titleId));

  const toggle = (titleId: TitleId, on: boolean): void => {
    onChange(on ? [...chosen, titleId] : chosen.filter((id) => id !== titleId));
  };

  return (
    <fieldset className={styles['field']} data-invalid={invalid ? '' : undefined}>
      <legend className={styles['legend']}>Titles on the line</legend>
      {options.length === 0 && stale.length === 0 ? (
        <p className={styles['hint']}>Your promotion has no active titles.</p>
      ) : (
        <ul className={styles['titles']}>
          {options.map((option) => {
            const inputId = `${idPrefix}-${option.titleId}`;
            const checked = chosen.includes(option.titleId);
            const missing = checked ? championMissingText(option, draft) : null;
            const notesId = `${inputId}-notes`;
            const hasNotes = option.otherBrand || missing !== null;
            return (
              <li key={option.titleId} className={styles['title']}>
                <input
                  id={inputId}
                  type="checkbox"
                  className={styles['checkbox']}
                  checked={checked}
                  disabled={disabled}
                  aria-describedby={hasNotes ? notesId : undefined}
                  onChange={(event) => {
                    toggle(option.titleId, event.target.checked);
                  }}
                />
                <label htmlFor={inputId} className={styles['titleLabel']}>
                  <ImageSlot
                    subject={{
                      kind: 'title',
                      id: option.titleId,
                      name: option.name,
                      ...(option.imageRef === null ? {} : { imageRef: option.imageRef }),
                    }}
                    size="sm"
                    decorative
                  />
                  <span className={styles['titleText']}>
                    <span className={styles['titleName']}>{option.name}</span>
                    <span className={styles['titleHolders']}>
                      {option.vacant ? 'Vacant' : namesText(option.holderNames)}
                    </span>
                  </span>
                </label>
                {hasNotes && (
                  <span id={notesId} className={styles['titleNotes']}>
                    {option.otherBrand && (
                      <span className={styles['warnNote']}>
                        This title belongs to another brand
                      </span>
                    )}
                    {missing !== null && <span className={styles['warnNote']}>{missing}</span>}
                  </span>
                )}
              </li>
            );
          })}
          {stale.map((titleId) => (
            <li key={titleId} className={styles['title']}>
              <input
                id={`${idPrefix}-${titleId}`}
                type="checkbox"
                className={styles['checkbox']}
                checked
                disabled={disabled}
                onChange={() => {
                  toggle(titleId, false);
                }}
              />
              <label htmlFor={`${idPrefix}-${titleId}`} className={styles['titleLabel']}>
                A title that is no longer active
              </label>
              <span className={styles['titleNotes']}>
                <span className={styles['titleHolders']}>Untick it to take it off</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
