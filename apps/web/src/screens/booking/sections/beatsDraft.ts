/**
 * The Beats section's rules (MTCH5-06), kept apart from the screen so they are tested on their own:
 * how a talking segment's stored beats become the BeatEditor's rows and back, which sides the
 * speakers stand on, and what the section says when booking can't store the groups.
 */
import type {
  AngleDraft,
  AngleTypeOption,
  BookingSectionView,
  BeatOption as EngineBeatOption,
  ContentKey,
  PersonId,
  PreviewAngleArgs,
} from '@ringside/engine';
import { assignAngleSides, sidesConflictMessage, toStoredBeat } from '@ringside/engine';
import type { BeatDraft, PersonChip } from '@/components/BeatEditor';

/** A stored beat: its key and its people, group one first. */
export type StoredBeat = NonNullable<AngleDraft['angle']['beats']>[number];

/** The speakers of a talking segment, as chips, in the order they were added. */
export function speakerChips(
  draft: AngleDraft,
  nameOf: (personId: PersonId) => string,
): PersonChip[] {
  return draft.participants
    .filter((person) => person.role === 'speaker')
    .map((person) => ({ id: person.personId, name: nameOf(person.personId) }));
}

function hasTwoGroups(beats: readonly EngineBeatOption[], beatKey: string): boolean {
  return (beats.find((option) => option.key === beatKey)?.groups.length ?? 1) > 1;
}

/**
 * One stored beat as an editor row. A two-group beat is split as the rater splits it: everyone on
 * the side of its first person is group one, everyone else group two.
 */
function rowOf(
  beat: { readonly beatKey: ContentKey; readonly personIds: readonly PersonId[] },
  id: string,
  beats: readonly EngineBeatOption[],
  sideOf: (personId: PersonId) => number,
  chipOf: (personId: PersonId) => PersonChip,
): BeatDraft {
  const people = beat.personIds.map(chipOf);
  if (!hasTwoGroups(beats, beat.beatKey)) {
    return { id, beatKey: beat.beatKey, groupOne: people, groupTwo: [] };
  }
  const [first] = beat.personIds;
  const firstSide = first === undefined ? 0 : sideOf(first);
  return {
    id,
    beatKey: beat.beatKey,
    groupOne: people.filter((person) => sideOf(person.id) === firstSide),
    groupTwo: people.filter((person) => sideOf(person.id) !== firstSide),
  };
}

/**
 * The editor's rows for a talking segment: its stored beats, or (before any were written) the
 * type's default beat with every speaker, the first side in group one and the others in group two,
 * which is what the engine would write on save.
 */
export function beatRowsOf(
  draft: AngleDraft,
  angleType: Pick<AngleTypeOption, 'defaultBeatKey'> | undefined,
  beats: readonly EngineBeatOption[],
  nameOf: (personId: PersonId) => string,
): BeatDraft[] {
  const sides = new Map(draft.participants.map((person) => [person.personId, person.side]));
  const sideOf = (personId: PersonId): number => sides.get(personId) ?? 0;
  const chipOf = (personId: PersonId): PersonChip => ({ id: personId, name: nameOf(personId) });
  const stored = draft.angle.beats;
  if (stored !== undefined) {
    return stored.map((beat, index) =>
      rowOf(beat, `beat-${String(index + 1)}`, beats, sideOf, chipOf),
    );
  }
  const defaultKey = angleType?.defaultBeatKey;
  if (defaultKey === undefined || defaultKey === null) return [];
  const speakers = draft.participants
    .filter((person) => person.role === 'speaker')
    .sort((left, right) => left.side - right.side);
  const groupOne = speakers.filter((person) => person.side === 0).map((p) => chipOf(p.personId));
  const others = speakers.filter((person) => person.side !== 0).map((p) => chipOf(p.personId));
  if (!hasTwoGroups(beats, defaultKey)) {
    return [
      { id: 'beat-1', beatKey: defaultKey, groupOne: [...groupOne, ...others], groupTwo: [] },
    ];
  }
  // With nobody on the first side, the second side leads (as the engine's default beat would).
  return groupOne.length === 0
    ? [{ id: 'beat-1', beatKey: defaultKey, groupOne: others, groupTwo: [] }]
    : [{ id: 'beat-1', beatKey: defaultKey, groupOne, groupTwo: others }];
}

/** The editor's rows as the engine takes them for a preview. */
export function previewBeatsOf(rows: readonly BeatDraft[]): PreviewAngleArgs['beats'] {
  return rows.map((row) => ({
    beatKey: row.beatKey as ContentKey,
    groupOne: row.groupOne.map((person) => person.id),
    groupTwo: row.groupTwo.map((person) => person.id),
  }));
}

/** What saving the rows writes, or why it can't. */
export type BeatsToSave =
  | {
      readonly ok: true;
      readonly beats: StoredBeat[];
      /** The side each person in a beat stands on (`assignAngleSides`). */
      readonly sides: Readonly<Record<PersonId, number>>;
    }
  | { readonly ok: false; readonly message: string };

/**
 * The rows as booking stores them: `toStoredBeat` (group one first) and the speakers' sides from
 * `assignAngleSides`. On a conflict (two people together in one beat and opposed in another) it
 * gives the `angle.sidesConflict` message and nothing to save.
 */
export function beatsToSave(
  rows: readonly BeatDraft[],
  beats: readonly EngineBeatOption[],
  nameOf: (personId: PersonId) => string,
): BeatsToSave {
  const grouped = previewBeatsOf(rows);
  const result = assignAngleSides(
    grouped.map((beat) => ({
      groupOne: beat.groupOne,
      groupTwo: beat.groupTwo,
      twoGroups: hasTwoGroups(beats, beat.beatKey),
    })),
  );
  if ('conflict' in result) {
    const { personA, personB, beatIndex } = result.conflict;
    const together = grouped.findIndex(
      (beat) =>
        hasTwoGroups(beats, beat.beatKey) &&
        beat.groupOne.includes(personA) &&
        beat.groupOne.includes(personB),
    );
    return {
      ok: false,
      message: sidesConflictMessage(
        nameOf(personA),
        nameOf(personB),
        together === -1 ? null : together,
        beatIndex,
      ),
    };
  }
  return { ok: true, beats: grouped.map((beat) => toStoredBeat(beat)), sides: result.sides };
}

/** The beat keys of the talking segments before this slot on the card, for repetition. */
export function earlierBeatKeys(
  sections: readonly BookingSectionView[],
  here: { readonly preShow: boolean; readonly slot: number },
): ContentKey[] {
  // The pre-show runs first, then the main card, each by slot.
  const before = (preShow: boolean, slot: number): boolean =>
    here.preShow ? preShow && slot < here.slot : preShow || slot < here.slot;
  return sections.flatMap((section) =>
    section.slots.flatMap((slot) => {
      const draft = slot.segment?.draft;
      if (draft?.kind !== 'angle' || !before(section.preShow, slot.slot)) return [];
      return (draft.angle.beats ?? []).map((beat) => beat.beatKey);
    }),
  );
}
