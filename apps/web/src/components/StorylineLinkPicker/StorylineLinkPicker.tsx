import { Link } from 'react-router-dom';
import { routes } from '@/app/routes';
import type {
  StorylineId,
  StorylineLinkedRow,
  StorylineOtherRow,
  StorylineSuggestionRow,
} from '@ringside/engine';
import { Badge } from '../Badge';
import { IconButton } from '../Button';
import { classNames } from '../classNames';
import { EmptyState } from '../EmptyState';
import { formatNumber } from '../format';
import { VisuallyHidden } from '../layout';
import { SegmentedMeter } from '../SegmentedMeter';
import { Select } from '../Select';
import { Switch } from '../Switch';
import styles from './StorylineLinkPicker.module.css';

/** A storyline the segment is linked to, as `storylines.linkOptions` lists it. */
export type LinkedStorylineView = Pick<
  StorylineLinkedRow,
  'storylineId' | 'name' | 'heat' | 'active' | 'membersHere' | 'isFinale' | 'finaleElsewhere'
>;

/** An active storyline with someone in the segment, not linked yet. */
export type SuggestedStorylineView = Pick<
  StorylineSuggestionRow,
  'storylineId' | 'name' | 'heat' | 'membersHere'
>;

/** Any other active storyline the segment could be linked to. */
export type StorylineOptionView = Pick<StorylineOtherRow, 'storylineId' | 'name' | 'heat'>;

/** Heat from which a storyline reads as hot when the engine's threshold isn't known. */
export const DEFAULT_HOT_FROM = 70;

export const NO_STORYLINES_TITLE = 'Your promotion has no active storylines';
export const NO_MEMBER_HERE_TEXT = "Won't count: nobody from this story is in the segment";
export const ENDED_LINK_TEXT = "Won't count: this storyline has ended";
export const LINK_ANOTHER_LABEL = 'Link another storyline';

/** "A segment can count for at most 2 storylines". */
export function limitText(maxLinks: number): string {
  return `A segment can count for at most ${formatNumber(maxLinks)} ${
    maxLinks === 1 ? 'storyline' : 'storylines'
  }`;
}

/** "Finale is currently Test Weekly, Slot 3". */
export function finaleElsewhereText(
  finale: NonNullable<LinkedStorylineView['finaleElsewhere']>,
): string {
  return `Finale is currently ${finale.showName}, ${finale.slot}`;
}

/** "2 here": how many of the storyline's people are in the segment. */
export function hereText(count: number): string {
  return `${formatNumber(count)} here`;
}

export interface StorylineLinkPickerProps {
  readonly linked: readonly LinkedStorylineView[];
  readonly suggestions: readonly SuggestedStorylineView[];
  readonly others: readonly StorylineOptionView[];
  /** `storylines.link.maxPerSegment`. */
  readonly maxLinks: number;
  /** A match on a card that can still change: each linked row offers its Finale switch. */
  readonly canSetFinale: boolean;
  /** Why nothing can change (the show has run): shown above a read-only list. */
  readonly disabledReason: string | null;
  /** True while a link or finale change is on its way: controls wait. */
  readonly pending: boolean;
  /** Heat from which the meter says "Hot". {@link DEFAULT_HOT_FROM} by default. */
  readonly hotFrom?: number;
  readonly onLink: (storylineId: StorylineId) => void;
  readonly onUnlink: (storylineId: StorylineId) => void;
  readonly onSetFinale: (storylineId: StorylineId, on: boolean) => void;
  readonly className?: string | undefined;
}

interface LinkedRowProps {
  readonly row: LinkedStorylineView;
  readonly hotFrom: number;
  readonly canSetFinale: boolean;
  readonly readOnly: boolean;
  readonly pending: boolean;
  readonly onUnlink: (storylineId: StorylineId) => void;
  readonly onSetFinale: (storylineId: StorylineId, on: boolean) => void;
}

function LinkedRow({
  row,
  hotFrom,
  canSetFinale,
  readOnly,
  pending,
  onUnlink,
  onSetFinale,
}: LinkedRowProps) {
  const warning = !row.active
    ? ENDED_LINK_TEXT
    : row.membersHere.length === 0
      ? NO_MEMBER_HERE_TEXT
      : null;
  return (
    <li className={styles['linkedRow']}>
      <div className={styles['linkedName']}>
        <span className={styles['name']} title={row.name}>
          {row.name}
        </span>
        {row.isFinale && <Badge tone="action">Finale</Badge>}
        {warning !== null && <Badge tone="prestige">{warning}</Badge>}
        {row.finaleElsewhere !== null && (
          <span className={styles['note']}>{finaleElsewhereText(row.finaleElsewhere)}</span>
        )}
      </div>
      <SegmentedMeter
        label="Heat"
        value={row.heat}
        valueText={formatNumber(Math.round(row.heat))}
        dangerFrom={hotFrom}
        dangerLabel="Hot"
        className={styles['meter']}
      />
      {!readOnly && (
        <div className={styles['controls']}>
          {canSetFinale && (
            <Switch
              label={`Finale of ${row.name}`}
              checked={row.isFinale}
              disabled={pending}
              onCheckedChange={(on) => {
                onSetFinale(row.storylineId, on);
              }}
              className={classNames(styles['finale'])}
            />
          )}
          <IconButton
            icon="close"
            label={`Unlink ${row.name}`}
            disabled={pending}
            onClick={() => {
              onUnlink(row.storylineId);
            }}
            className={styles['unlink']}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Which storylines a segment counts for (CRTV4-04): one-tap suggestions for storylines with
 * people in it, the linked list with heat, Unlink and (for a match) the Finale switch, and a
 * picker for the rest. Props only: the Booking editor's Storyline section feeds it
 * `storylines.linkOptions` and runs the commands.
 */
export function StorylineLinkPicker({
  linked,
  suggestions,
  others,
  maxLinks,
  canSetFinale,
  disabledReason,
  pending,
  hotFrom = DEFAULT_HOT_FROM,
  onLink,
  onUnlink,
  onSetFinale,
  className,
}: StorylineLinkPickerProps) {
  const readOnly = disabledReason !== null;
  const atLimit = linked.length >= maxLinks;
  const addDisabled = pending || atLimit;

  if (linked.length === 0 && suggestions.length === 0 && others.length === 0) {
    return (
      <EmptyState
        icon="storylines"
        size="inline"
        headingLevel={4}
        title={NO_STORYLINES_TITLE}
        body={
          <>
            Start one on the <Link to={routes.game.storylines()}>Storylines</Link> desk, then link
            its segments here.
          </>
        }
        className={className}
      />
    );
  }

  return (
    <div className={classNames(styles['picker'], className)}>
      {readOnly && (
        <p className={styles['reason']} role="status">
          {disabledReason}
        </p>
      )}
      {!readOnly && atLimit && <p className={styles['note']}>{limitText(maxLinks)}</p>}

      {!readOnly && suggestions.length > 0 && (
        <div className={styles['group']}>
          <h4 className={styles['groupTitle']}>Suggested</h4>
          <ul className={styles['chips']} aria-label="Suggested storylines">
            {suggestions.map((suggestion) => (
              <li key={suggestion.storylineId}>
                <button
                  type="button"
                  className={styles['chip']}
                  disabled={addDisabled}
                  onClick={() => {
                    onLink(suggestion.storylineId);
                  }}
                >
                  {/* Named by its visible text, with "Link" and commas for screen readers. */}
                  <VisuallyHidden>Link </VisuallyHidden>
                  <span className={styles['chipName']} title={suggestion.name}>
                    {suggestion.name}
                  </span>
                  <VisuallyHidden>, </VisuallyHidden>
                  <span className={styles['chipFact']}>
                    {hereText(suggestion.membersHere.length)}
                  </span>
                  <VisuallyHidden>, </VisuallyHidden>
                  <span
                    className={styles['chipFact']}
                    data-hot={suggestion.heat >= hotFrom ? '' : undefined}
                  >
                    {`heat ${formatNumber(Math.round(suggestion.heat))}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles['group']}>
        <h4 className={styles['groupTitle']}>Linked</h4>
        {linked.length === 0 ? (
          <p className={styles['note']}>Not linked to a storyline yet.</p>
        ) : (
          <ul className={styles['linked']} aria-label="Linked storylines">
            {linked.map((row) => (
              <LinkedRow
                key={row.storylineId}
                row={row}
                hotFrom={hotFrom}
                canSetFinale={canSetFinale}
                readOnly={readOnly}
                pending={pending}
                onUnlink={onUnlink}
                onSetFinale={onSetFinale}
              />
            ))}
          </ul>
        )}
      </div>

      {!readOnly && others.length > 0 && (
        <Select
          label={LINK_ANOTHER_LABEL}
          placeholder="Pick a storyline"
          value=""
          disabled={addDisabled}
          options={others.map((other) => ({
            value: other.storylineId,
            label: `${other.name} (heat ${formatNumber(Math.round(other.heat))})`,
          }))}
          onValueChange={(value) => {
            const picked = others.find((other) => other.storylineId === value);
            if (picked !== undefined) onLink(picked.storylineId);
          }}
          className={classNames(styles['another'])}
        />
      )}
    </div>
  );
}
