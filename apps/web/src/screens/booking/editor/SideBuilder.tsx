import type {
  AngleTypeOption,
  AvailableWorkerRow,
  BookingCard,
  MatchTypeOption,
  PersonId,
  SegmentDraft,
} from '@ringside/engine';
import { Button, IconButton } from '@/components/Button';
import { ImageSlot } from '@/components/ImageSlot';
import { AvailabilityBadge } from '@/components/RosterPicker';
import { WorkerLink } from '@/components/WorkerLink';
import { sideLabel } from './editorText';
import styles from './SegmentEditor.module.css';
import type { PickerTarget } from './EditorRosterPicker';
import { cardNameOf } from './useRoster';
import { peopleOnSide } from './useSegmentDraft';
import type { SideLimits } from './useSegmentDraft';

/** "Needs 1 more on this side", "1 too many on this side", or null when the side fits. */
export function sideHint(count: number, sideSize: { min: number; max: number }): string | null {
  if (count < sideSize.min) return `Needs ${String(sideSize.min - count)} more on this side`;
  if (count > sideSize.max) return `${String(count - sideSize.max)} too many on this side`;
  return null;
}

/** "Needs 1 more speaker", "2 too many speakers", or null when the count fits. */
export function speakerHint(count: number, speakers: { min: number; max: number }): string | null {
  if (count < speakers.min) {
    const missing = speakers.min - count;
    return `Needs ${String(missing)} more ${missing === 1 ? 'speaker' : 'speakers'}`;
  }
  if (count > speakers.max) {
    const extra = count - speakers.max;
    return `${String(extra)} too many ${extra === 1 ? 'speaker' : 'speakers'}; the most is ${String(speakers.max)}`;
  }
  return null;
}

export interface SideBuilderProps {
  readonly draft: SegmentDraft;
  readonly sideCount: number;
  readonly limits: SideLimits;
  readonly matchType: MatchTypeOption | undefined;
  readonly angleType: AngleTypeOption | undefined;
  readonly card: BookingCard;
  readonly roster: ReadonlyMap<PersonId, AvailableWorkerRow>;
  readonly disabled: boolean;
  /** True when a refusal points at the participants. */
  readonly invalid: boolean;
  readonly onOpenPicker: (target: PickerTarget) => void;
  readonly onRemovePerson: (personId: PersonId, name: string) => void;
  readonly onAddSide: () => void;
  readonly onRemoveSide: (side: number) => void;
}

interface PersonRowProps {
  readonly personId: PersonId;
  readonly side: number;
  readonly kind: SegmentDraft['kind'];
  readonly row: AvailableWorkerRow | undefined;
  readonly fallbackName: string;
  readonly disabled: boolean;
  readonly onRemove: () => void;
}

/** One person on a side: picture, name linked to their profile, availability, Remove. */
function PersonRow({
  personId,
  side,
  kind,
  row,
  fallbackName,
  disabled,
  onRemove,
}: PersonRowProps) {
  const name = row?.ringName ?? fallbackName;
  const where = kind === 'match' ? sideLabel(side) : 'the speakers';
  return (
    <li className={styles['person']}>
      <ImageSlot
        subject={{
          kind: 'person',
          id: personId,
          name,
          ...(row?.imageRef == null ? {} : { imageRef: row.imageRef }),
        }}
        size="sm"
        decorative
      />
      <span className={styles['personText']}>
        <WorkerLink personId={personId} name={name} truncate />
        <span className={styles['personChips']}>
          {row === undefined ? (
            <span className={styles['hint']}>Not on the roster any more</span>
          ) : (
            <AvailabilityBadge status={row.availability.status} label={row.availability.label} />
          )}
          {row?.otherBrand === true && row.brandName !== null && (
            <span className={styles['warnNote']}>Other brand: {row.brandName}</span>
          )}
        </span>
        {row !== undefined && !row.bookable && (
          <span className={styles['personReason']}>{row.availability.reason}</span>
        )}
      </span>
      <IconButton
        icon="close"
        size="sm"
        variant="ghost"
        label={`Remove ${name} from ${where}`}
        disabled={disabled}
        onClick={onRemove}
      />
    </li>
  );
}

/**
 * The sides of the draft: one block per side (a talking segment's speakers, with a second side
 * for a face-off), each with its people and Add buttons. Hints come from the catalog's limits
 * only; the engine and the checklist judge everything else.
 */
export function SideBuilder({
  draft,
  sideCount,
  limits,
  matchType,
  angleType,
  card,
  roster,
  disabled,
  invalid,
  onOpenPicker,
  onRemovePerson,
  onAddSide,
  onRemoveSide,
}: SideBuilderProps) {
  const isMatch = draft.kind === 'match';
  const speakers = draft.participants.filter((person) => person.role === 'speaker').length;
  const speakersFull = angleType !== undefined && speakers >= angleType.speakers.max;
  const angleHint =
    !isMatch && angleType !== undefined ? speakerHint(speakers, angleType.speakers) : null;
  const sides = Array.from({ length: sideCount }, (_unused, side) => side);

  return (
    <fieldset className={styles['field']} data-invalid={invalid ? '' : undefined}>
      <legend className={styles['legend']}>{isMatch ? 'Sides' : 'Speakers'}</legend>
      {angleHint !== null && <p className={styles['hint']}>{angleHint}</p>}
      <ol className={styles['sides']}>
        {sides.map((side) => {
          const people = peopleOnSide(draft, side);
          const heading = isMatch
            ? sideLabel(side)
            : sideCount > 1
              ? side === 0
                ? 'Speakers'
                : 'Facing them'
              : 'Speakers';
          const hint =
            isMatch && matchType !== undefined ? sideHint(people.length, matchType.sideSize) : null;
          const full = isMatch
            ? matchType !== undefined && people.length >= matchType.sideSize.max
            : speakersFull;
          const canAddTeam = isMatch && matchType !== undefined && matchType.sideSize.max > 1;
          return (
            <li key={`side-${String(side)}`} className={styles['side']}>
              <div className={styles['sideHead']}>
                <h4 className={styles['sideTitle']}>{heading}</h4>
                {hint !== null && <span className={styles['hint']}>{hint}</span>}
                {sideCount > limits.min && (
                  <Button
                    size="sm"
                    variant="ghost"
                    iconStart="trash"
                    disabled={disabled}
                    onClick={() => {
                      onRemoveSide(side);
                    }}
                  >
                    {isMatch ? `Remove ${sideLabel(side)}` : 'Remove this side'}
                  </Button>
                )}
              </div>
              {people.length === 0 ? (
                <p className={styles['empty']}>Nobody yet</p>
              ) : (
                <ul className={styles['people']}>
                  {people.map((person) => {
                    const row = roster.get(person.personId);
                    const fallbackName =
                      cardNameOf(card, person.personId) ?? 'Someone off the roster';
                    return (
                      <PersonRow
                        key={person.personId}
                        personId={person.personId}
                        side={side}
                        kind={draft.kind}
                        row={row}
                        fallbackName={fallbackName}
                        disabled={disabled}
                        onRemove={() => {
                          onRemovePerson(person.personId, row?.ringName ?? fallbackName);
                        }}
                      />
                    );
                  })}
                </ul>
              )}
              <div className={styles['sideActions']}>
                <Button
                  size="sm"
                  iconStart="add"
                  disabled={disabled || full}
                  onClick={() => {
                    onOpenPicker({ side, mode: 'people' });
                  }}
                >
                  {isMatch ? 'Add wrestler' : 'Add speaker'}
                </Button>
                {canAddTeam && (
                  <Button
                    size="sm"
                    variant="ghost"
                    iconStart="users"
                    disabled={disabled || full}
                    onClick={() => {
                      onOpenPicker({ side, mode: 'teams' });
                    }}
                  >
                    Add team
                  </Button>
                )}
                {full && (
                  <span className={styles['hint']}>
                    {isMatch ? 'This side is full' : 'That’s the most speakers this type takes'}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {sideCount < limits.max && (
        <Button
          size="sm"
          variant="ghost"
          iconStart="add"
          disabled={disabled}
          onClick={onAddSide}
          className={styles['addSide']}
        >
          {isMatch ? 'Add side' : 'Add a side facing them'}
        </Button>
      )}
    </fieldset>
  );
}
