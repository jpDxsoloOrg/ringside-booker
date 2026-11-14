import { describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { AvailableTeamRow, AvailableWorkerRow, PersonId } from '@ringside/engine';
import {
  GALLERY_EDITOR_CARD,
  GALLERY_SINGLES,
  galleryWorkerRows,
} from '@/screens/dev-gallery/fixtures/segmentEditor';
import { pickerPerson, pickerTeam, statsNoteText, workerTypeLabel } from './EditorRosterPicker';

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

const CONTEXT = {
  kind: 'match' as const,
  draft: DRAFT,
  card: CARD,
  segmentId: null,
  regionName: 'Greater Lakes',
};

describe('EditorRosterPicker rows', () => {
  it('gives a wrestler their style, popularity in the show region and stamina, rounded', () => {
    const row = { ...rowOn([]), style: 'highFlyer' as const, popularity: 54.6, stamina: 72.4 };
    const picked = pickerPerson(row, CONTEXT);
    expect(picked.typeLabel).toBe('High flyer');
    expect(picked.stats).toEqual([
      { key: 'popularity', short: 'Pop', label: 'Popularity in Greater Lakes', value: 54.6 },
      { key: 'stamina', short: 'Stamina', label: 'Stamina', value: 72 },
    ]);
    expect(statsNoteText('Greater Lakes')).toBe(
      'Pop: popularity in Greater Lakes, where this show is.',
    );
  });

  it('names a manager by role and leaves stamina off for anyone who does not wrestle', () => {
    const row = {
      ...rowOn([]),
      employmentRole: 'manager' as const,
      style: 'nonWrestler' as const,
      popularity: 0,
    };
    expect(workerTypeLabel(row)).toBe('Manager');
    const picked = pickerPerson(row, { ...CONTEXT, kind: 'angle' });
    expect(picked.typeLabel).toBe('Manager');
    expect(picked.stats?.map((stat) => `${stat.short} ${String(stat.value)}`)).toEqual(['Pop 0']);
  });

  it('marks someone booked in another segment, not the one being edited', () => {
    const context = { ...CONTEXT, segmentId: EDITED };
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
      titles: [],
    };
    expect(pickerTeam(team, roster, DRAFT, EDITED).bookedElsewhere).toBe(true);
    expect(pickerTeam(team, roster, DRAFT, OTHER).bookedElsewhere).toBe(false);
  });

  it('carries gender and push, for a person and for each team member', () => {
    const woman: AvailableWorkerRow = { ...rowOn([]), gender: 'female', push: 'mainEvent' };
    const picked = pickerPerson(woman, CONTEXT);
    expect(picked.gender).toBe('female');
    expect(picked.push).toBe('mainEvent');
    const man: AvailableWorkerRow = {
      ...rowOn([]),
      personId: parseId('person', 'per_0000000999'),
      gender: 'male',
      push: 'lowerCard',
    };
    const roster = new Map<PersonId, AvailableWorkerRow>([
      [woman.personId, woman],
      [man.personId, man],
    ]);
    const team: AvailableTeamRow = {
      teamId: parseId('team', 'tem_0000000001'),
      name: 'Odd Couple',
      kind: 'tag',
      memberIds: [woman.personId, man.personId],
      bookable: true,
      titles: [],
    };
    const row = pickerTeam(team, roster, DRAFT);
    expect(row.memberGenders).toEqual(['female', 'male']);
    expect(row.memberPushes).toEqual(['mainEvent', 'lowerCard']);
  });
  it('carries titles and storylines, and a team is in every storyline any member is (EVT2-13)', () => {
    const crown = { storylineId: parseId('storyline', 'sty_0000000001'), name: 'The Crown Chase' };
    const storm = { storylineId: parseId('storyline', 'sty_0000000002'), name: 'Storm Warning' };
    const champ: AvailableWorkerRow = {
      ...rowOn([]),
      titles: [
        { titleId: parseId('title', 'tit_0000000001'), name: 'Coastal Tag Team Championship' },
      ],
      storylines: [{ ...crown, side: 'face' }],
    };
    const partner: AvailableWorkerRow = {
      ...rowOn([]),
      personId: parseId('person', 'per_0000000999'),
      titles: [],
      storylines: [
        { ...crown, side: 'face' },
        { ...storm, side: 'heel' },
      ],
    };
    const picked = pickerPerson(champ, CONTEXT);
    expect(picked.titles).toEqual(['Coastal Tag Team Championship']);
    expect(picked.storylines).toEqual([{ ...crown, side: 'face' }]);
    const roster = new Map<PersonId, AvailableWorkerRow>([
      [champ.personId, champ],
      [partner.personId, partner],
    ]);
    const team = pickerTeam(
      {
        teamId: parseId('team', 'tem_0000000001'),
        name: 'The Hale Storm',
        kind: 'tag',
        memberIds: [champ.personId, partner.personId],
        bookable: true,
        titles: [
          { titleId: parseId('title', 'tit_0000000001'), name: 'Coastal Tag Team Championship' },
        ],
      },
      roster,
      DRAFT,
    );
    expect(team.titles).toEqual(['Coastal Tag Team Championship']);
    expect(team.storylineIds).toEqual([crown.storylineId, storm.storylineId]);
  });
});
