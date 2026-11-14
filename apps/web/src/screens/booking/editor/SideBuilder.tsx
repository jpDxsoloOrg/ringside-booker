import { rolesText } from '@ringside/engine';
import type {
  AngleTypeOption,
  AvailableWorkerRow,
  BeatGroupOption,
  BookingCard,
  MatchTypeOption,
  ParticipantDraft,
  PersonId,
  SegmentDraft,
  TalkRole,
} from '@ringside/engine';
import { Button, IconButton } from '@/components/Button';
import { ImageSlot } from '@/components/ImageSlot';
import { AvailabilityBadge } from '@/components/RosterPicker';
import { WorkerLink } from '@/components/WorkerLink';
import { sideLabel } from './editorText';
import styles from './SegmentEditor.module.css';
import type { PickerTarget } from './EditorRosterPicker';
import { PartField } from './TalkFields';
import type { ClientOption } from './TalkFields';
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
  /** The team each side is, by stored side ("Running Axe"), or null for a side of individuals. */
  readonly teamNames?: readonly (string | null)[];
  readonly disabled: boolean;
  /** True when a refusal points at the participants. */
  readonly invalid: boolean;
  readonly onOpenPicker: (target: PickerTarget) => void;
  readonly onRemovePerson: (personId: PersonId, name: string) => void;
  readonly onAddSide: () => void;
  readonly onRemoveSide: (side: number) => void;
  /** MTCH5-08: a talking segment's parts. Left out, speakers have no part to choose. */
  readonly talk?: SideTalk;
}

/** MTCH5-08: what the sides of a talking segment need to show and change each speaker's part. */
export interface SideTalk {
  /** The beat group each side fills (by stored side), or null without a beat catalog. */
  readonly groups: readonly (BeatGroupOption | null)[];
  /** True when each side is a group of its own ("Guest", "Host"). */
  readonly sidesAreGroups: boolean;
  readonly onSetPart: (
    personId: PersonId,
    talkRole: TalkRole,
    forPersonId: PersonId | null,
  ) => void;
  readonly onAddManager: (side: number, managerId: PersonId, clientId: PersonId) => void;
}

/** The part and "Add their manager" for one speaker. */
interface PersonTalk {
  readonly participant: ParticipantDraft;
  readonly clients: readonly ClientOption[];
  readonly group: BeatGroupOption | null;
  /** Their contract's manager when not in the segment yet and the segment has room. */
  readonly manager: { readonly personId: PersonId; readonly name: string } | null;
  readonly onSetPart: SideTalk['onSetPart'];
  readonly onAddManager: () => void;
}

interface PersonRowProps {
  readonly personId: PersonId;
  readonly side: number;
  readonly kind: SegmentDraft['kind'];
  readonly row: AvailableWorkerRow | undefined;
  readonly fallbackName: string;
  readonly disabled: boolean;
  readonly onRemove: () => void;
  readonly talk?: PersonTalk | undefined;
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
  talk,
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
        <WorkerLink personId={personId} name={name} truncate className={styles['personLink']} />
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
        {talk !== undefined && (
          <PartField
            name={name}
            talkRole={talk.participant.talkRole ?? row?.talkRole ?? 'wrestler'}
            forPersonId={talk.participant.forPersonId ?? null}
            clients={talk.clients}
            group={talk.group}
            disabled={disabled}
            onChange={(talkRole, forPersonId) => {
              talk.onSetPart(personId, talkRole, forPersonId);
            }}
          />
        )}
        {talk?.manager != null && (
          <span>
            <Button
              size="sm"
              variant="ghost"
              iconStart="add"
              disabled={disabled}
              onClick={talk.onAddManager}
            >
              {`Add their manager, ${talk.manager.name}`}
            </Button>
          </span>
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
  teamNames = [],
  disabled,
  invalid,
  onOpenPicker,
  onRemovePerson,
  onAddSide,
  onRemoveSide,
  talk,
}: SideBuilderProps) {
  const isMatch = draft.kind === 'match';
  const speakers = draft.participants.filter((person) => person.role === 'speaker').length;
  const speakersFull = angleType !== undefined && speakers >= angleType.speakers.max;
  const angleHint =
    !isMatch && angleType !== undefined ? speakerHint(speakers, angleType.speakers) : null;
  const sides = Array.from({ length: sideCount }, (_unused, side) => side);
  const nameOf = (personId: PersonId): string =>
    roster.get(personId)?.ringName ?? cardNameOf(card, personId) ?? 'Someone off the roster';
  /** MTCH5-08: one speaker's part, the others they can manage and their manager to add. */
  const talkOf = (
    participant: ParticipantDraft,
    side: number,
    group: BeatGroupOption | null,
  ): PersonTalk | undefined => {
    if (talk === undefined || participant.role !== 'speaker') return undefined;
    const managerId = roster.get(participant.personId)?.managerPersonId ?? null;
    const managerRow = managerId === null ? undefined : roster.get(managerId);
    const managerFree =
      managerRow !== undefined &&
      managerRow.bookable &&
      !speakersFull &&
      !draft.participants.some((person) => person.personId === managerRow.personId);
    return {
      participant,
      clients: draft.participants
        .filter((person) => person.personId !== participant.personId)
        .map((person) => ({ personId: person.personId, name: nameOf(person.personId) })),
      group,
      manager: managerFree ? { personId: managerRow.personId, name: managerRow.ringName } : null,
      onSetPart: talk.onSetPart,
      onAddManager: () => {
        if (managerRow !== undefined) {
          talk.onAddManager(side, managerRow.personId, participant.personId);
        }
      },
    };
  };

  return (
    <fieldset className={styles['field']} data-invalid={invalid ? '' : undefined}>
      <legend className={styles['legend']}>{isMatch ? 'Sides' : 'Speakers'}</legend>
      {angleHint !== null && <p className={styles['hint']}>{angleHint}</p>}
      <ol className={styles['sides']}>
        {sides.map((side) => {
          const people = peopleOnSide(draft, side);
          const group = talk?.groups[side] ?? null;
          const heading = isMatch
            ? sideLabel(side)
            : talk?.sidesAreGroups === true && group !== null
              ? group.label
              : sideCount > 1
                ? side === 0
                  ? 'Speakers'
                  : 'Facing them'
                : 'Speakers';
          const groupRoles = !isMatch && group !== null ? rolesText(group.roles) : '';
          const hint =
            isMatch && matchType !== undefined ? sideHint(people.length, matchType.sideSize) : null;
          const full = isMatch
            ? matchType !== undefined && people.length >= matchType.sideSize.max
            : speakersFull;
          const teamName = isMatch ? (teamNames[side] ?? null) : null;
          const canAddTeam = isMatch && matchType !== undefined && matchType.sideSize.max > 1;
          return (
            <li key={`side-${String(side)}`} className={styles['side']}>
              <div className={styles['sideHead']}>
                <h4 className={styles['sideTitle']}>{heading}</h4>
                {groupRoles !== '' && <span className={styles['groupRoles']}>{groupRoles}</span>}
                {teamName !== null && <span className={styles['teamName']}>Team: {teamName}</span>}
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
                    const personTalk = talk === undefined ? undefined : talkOf(person, side, group);
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
                        talk={personTalk}
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
          {isMatch
            ? 'Add side'
            : talk?.sidesAreGroups === true && talk.groups[1] != null
              ? `Add ${talk.groups[1].label}`
              : 'Add a side facing them'}
        </Button>
      )}
    </fieldset>
  );
}
