import { useMemo, useState } from 'react';
import { PUSH_LABELS } from '@ringside/engine';
import type {
  AvailableTeamRow,
  AvailableWorkerRow,
  BookingCard,
  EventInstanceId,
  PersonId,
  SegmentDraft,
  SegmentId,
  TeamId,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { RosterPicker } from '@/components/RosterPicker';
import type {
  RosterPickerMode,
  RosterPickerPerson,
  RosterPickerTeam,
} from '@/components/RosterPicker';
import type { SegmentEditorKind } from './editorStore';
import { namesText, sideLabel, slotNameOnCard } from './editorText';

/** Where the picker adds people, or null while it is closed. */
export interface PickerTarget {
  readonly side: number;
  readonly mode: RosterPickerMode;
}

/** Why someone can't be booked for this kind of segment, in plain words. */
function unbookableReason(row: AvailableWorkerRow, kind: SegmentEditorKind): string {
  return kind === 'match'
    ? `Can't wrestle on this date: ${row.availability.reason}`
    : `Can't appear on this date: ${row.availability.reason}`;
}

/** A row of `booking.availableWorkers` as the picker shows it for this draft. */
export function pickerPerson(
  row: AvailableWorkerRow,
  context: {
    readonly kind: SegmentEditorKind;
    readonly draft: SegmentDraft;
    readonly card: BookingCard;
    readonly segmentId: SegmentId | null;
  },
): RosterPickerPerson {
  const inDraft = context.draft.participants.find((person) => person.personId === row.personId);
  const reason = !row.bookable
    ? unbookableReason(row, context.kind)
    : inDraft !== undefined
      ? `Already on ${sideLabel(inDraft.side)} of this segment`
      : null;
  const notes = [
    ...(row.otherBrand && row.brandName !== null ? [`Other brand: ${row.brandName}`] : []),
    ...row.onCard
      .filter((place) => place.segmentId !== context.segmentId)
      .map(
        (place) =>
          `On this card: ${slotNameOnCard(context.card, place.segmentId, place.slotLabel)}`,
      ),
  ];
  return {
    personId: row.personId,
    name: row.ringName,
    imageRef: row.imageRef,
    pushLabel: PUSH_LABELS[row.push],
    alignment: row.alignment,
    availability: { status: row.availability.status, label: row.availability.label },
    selectable: row.bookable && inDraft === undefined,
    bookable: row.bookable,
    reason,
    otherBrand: row.otherBrand,
    notes,
  };
}

/** A team row as the picker shows it: members named, and who stops it being bookable. */
export function pickerTeam(
  team: AvailableTeamRow,
  people: ReadonlyMap<PersonId, AvailableWorkerRow>,
  draft: SegmentDraft,
): RosterPickerTeam {
  const members = team.memberIds.map((personId) => people.get(personId));
  const memberNames = team.memberIds.map(
    (personId, index) => members[index]?.ringName ?? 'Someone off the roster',
  );
  const unbookable = members.flatMap((member) =>
    member !== undefined && !member.bookable
      ? [`${member.ringName}: ${member.availability.label}`]
      : [],
  );
  const placed = memberNames.filter((_name, index) =>
    draft.participants.some((person) => person.personId === team.memberIds[index]),
  );
  const reason = !team.bookable
    ? `Not everyone can be booked: ${unbookable.join('; ') || 'a member is unavailable'}`
    : placed.length > 0
      ? `${namesText(placed)} ${placed.length === 1 ? 'is' : 'are'} already in this segment`
      : null;
  return {
    teamId: team.teamId,
    name: team.name,
    memberNames,
    selectable: team.bookable && placed.length === 0,
    bookable: team.bookable,
    reason,
    otherBrand: members.some((member) => member?.otherBrand === true),
  };
}

export interface EditorRosterPickerProps {
  readonly target: PickerTarget | null;
  readonly eventInstanceId: EventInstanceId;
  readonly kind: SegmentEditorKind;
  readonly draft: SegmentDraft;
  readonly card: BookingCard;
  /** The segment being edited, so its own people don't read "On this card". */
  readonly segmentId: SegmentId | null;
  /** The whole roster, for team members' names. */
  readonly roster: ReadonlyMap<PersonId, AvailableWorkerRow>;
  /** "Side 1: 1 of 2", above the list. */
  readonly status?: string;
  readonly onPickPerson: (side: number, personId: PersonId, name: string) => void;
  readonly onPickTeam: (
    side: number,
    teamId: TeamId,
    memberIds: readonly PersonId[],
    name: string,
  ) => void;
  readonly onClose: () => void;
}

/** The roster picker fed by `booking.availableWorkers` for the show and the draft's kind. */
export function EditorRosterPicker({
  target,
  eventInstanceId,
  kind,
  draft,
  card,
  segmentId,
  roster,
  status,
  onPickPerson,
  onPickTeam,
  onClose,
}: EditorRosterPickerProps) {
  const open = target !== null;
  // The picker keeps its last side while it slides away, so its title doesn't jump.
  const [shown, setShown] = useState<PickerTarget>(target ?? { side: 0, mode: 'people' });
  if (target !== null && (target.side !== shown.side || target.mode !== shown.mode)) {
    setShown(target);
  }
  const [search, setSearch] = useState('');
  const query = useEngineQuery(
    'booking.availableWorkers',
    { eventInstanceId, kind, ...(search === '' ? {} : { search }) },
    { enabled: open, keepPreviousData: true },
  );
  const people = useMemo(
    () =>
      (query.data?.people ?? []).map((row) => pickerPerson(row, { kind, draft, card, segmentId })),
    [query.data, kind, draft, card, segmentId],
  );
  const teams = useMemo(
    () => (query.data?.teams ?? []).map((team) => pickerTeam(team, roster, draft)),
    [query.data, roster, draft],
  );

  const side = shown.side;
  return (
    <RosterPicker
      open={open}
      onClose={onClose}
      title={kind === 'angle' ? 'Add a speaker' : `Add to ${sideLabel(side)}`}
      people={people}
      {...(kind === 'match' ? { teams } : {})}
      initialMode={shown.mode}
      loading={query.status === 'loading'}
      onSearchChange={setSearch}
      onPickPerson={(person) => {
        onPickPerson(side, person.personId, person.name);
      }}
      onPickTeam={(team) => {
        const row = query.data?.teams.find((candidate) => candidate.teamId === team.teamId);
        if (row !== undefined) onPickTeam(side, team.teamId, row.memberIds, team.name);
      }}
      {...(status === undefined ? {} : { status })}
    />
  );
}
