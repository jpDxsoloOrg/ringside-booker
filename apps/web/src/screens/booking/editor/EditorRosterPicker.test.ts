import { describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { AvailableTeamRow, PersonId } from '@ringside/engine';
import {
  GALLERY_EDITOR_CARD,
  GALLERY_SINGLES,
  galleryWorkerRows,
} from '@/screens/dev-gallery/fixtures/segmentEditor';
import { pickerPerson, pickerTeam } from './EditorRosterPicker';

const EDITED = parseId('segment', 'seg_0000000901');
const OTHER = parseId('segment', 'seg_0000000902');
// The gallery's singles draft has persons 2 and 3; the rows below are person 0 and 999.
const DRAFT = GALLERY_SINGLES.draft;
const CARD = GALLERY_EDITOR_CARD;

function rowOn(segmentIds: readonly (typeof EDITED)[]) {
  const [row] = galleryWorkerRows('match');
  if (row === undefined) throw new Error('the gallery roster is empty');
  return {
    ...row,
    onCard: segmentIds.map((segmentId) => ({ segmentId, slotLabel: 'Slot 1' })),
  };
}

describe('EditorRosterPicker rows', () => {
  it('marks someone booked in another segment, not the one being edited', () => {
    const context = { kind: 'match' as const, draft: DRAFT, card: CARD, segmentId: EDITED };
    expect(pickerPerson(rowOn([OTHER]), context).bookedElsewhere).toBe(true);
    expect(pickerPerson(rowOn([EDITED]), context).bookedElsewhere).toBe(false);
    expect(pickerPerson(rowOn([]), context).bookedElsewhere).toBe(false);
    // A new segment has no id, so anywhere on the card counts.
    expect(pickerPerson(rowOn([EDITED]), { ...context, segmentId: null }).bookedElsewhere).toBe(
      true,
    );
  });

  it('marks a team when any member is booked in another segment', () => {
    const member = rowOn([OTHER]);
    const free = { ...rowOn([]), personId: parseId('person', 'per_0000000999') };
    const roster = new Map<PersonId, typeof member>([
      [member.personId, member],
      [free.personId, free],
    ]);
    const team: AvailableTeamRow = {
      teamId: parseId('team', 'tem_0000000001'),
      name: 'The Hale Storm',
      kind: 'tag',
      memberIds: [member.personId, free.personId],
      bookable: true,
    };
    expect(pickerTeam(team, roster, DRAFT, EDITED).bookedElsewhere).toBe(true);
    expect(pickerTeam(team, roster, DRAFT, OTHER).bookedElsewhere).toBe(false);
  });
});
