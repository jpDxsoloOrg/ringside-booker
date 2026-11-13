import { describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { ShowCardSegment, ShowCardSlot } from '@ringside/engine';
import { CHAMPIONS_LABEL, rivalSlotKey, toRivalCardSlotProps } from './rivalCardSlotProps';

const ACE = parseId('person', 'per_0000000001');
const ROOKIE = parseId('person', 'per_0000000002');
const PARTNER = parseId('person', 'per_0000000003');
const TEAM = parseId('team', 'tem_0000000001');

function segment(overrides: Partial<ShowCardSegment> = {}): ShowCardSegment {
  return {
    segmentId: parseId('segment', 'seg_0000000001'),
    kind: 'match',
    typeName: 'Singles',
    label: 'Ace vs Rookie',
    sides: [
      {
        name: 'Ace',
        teamId: null,
        isChampions: true,
        people: [{ personId: ACE, name: 'Ace', imageRef: null }],
      },
      {
        name: 'Rookie',
        teamId: null,
        isChampions: false,
        people: [{ personId: ROOKIE, name: 'Rookie', imageRef: 'people/rookie.png' }],
      },
    ],
    titles: [{ titleId: parseId('title', 'tit_0000000001'), name: 'World Title', imageRef: null }],
    storylines: [{ storylineId: parseId('storyline', 'sty_0000000001'), name: 'Ace and Rookie' }],
    outcome: null,
    reasonTraceRef: null,
    ...overrides,
  };
}

function slot(overrides: Partial<ShowCardSlot> = {}): ShowCardSlot {
  return {
    displayNumber: 6,
    preShow: false,
    role: 'mainEvent',
    roleLabel: 'Main event',
    segment: segment(),
    ...overrides,
  };
}

describe('toRivalCardSlotProps', () => {
  it('turns the engine’s roles into CardSlot’s', () => {
    const roles = [
      ['preShow', 'pre-show'],
      ['opener', 'opener'],
      ['midcard', 'midcard'],
      ['semiMain', 'semi-main'],
      ['mainEvent', 'main-event'],
    ] as const;
    for (const [role, slotRole] of roles) {
      expect(toRivalCardSlotProps(slot({ role })).slotRole).toBe(slotRole);
    }
    expect(toRivalCardSlotProps(slot())).toMatchObject({ slotNumber: 6, roleLabel: 'Main event' });
  });

  it('gives a chip for the type, each title and each storyline', () => {
    expect(toRivalCardSlotProps(slot()).chips).toEqual([
      { id: 'type', kind: 'match-type', label: 'Singles' },
      { id: 'title-tit_0000000001', kind: 'title', label: 'World Title' },
      { id: 'storyline-sty_0000000001', kind: 'storyline', label: 'Ace and Rookie' },
    ]);
  });

  it('marks the champions and draws each person', () => {
    const [ace, rookie] = toRivalCardSlotProps(slot()).sides;
    expect(ace).toMatchObject({ name: 'Ace', label: CHAMPIONS_LABEL });
    expect(ace?.members).toEqual([{ kind: 'person', id: ACE, name: 'Ace' }]);
    expect(rookie).not.toHaveProperty('label');
    expect(rookie?.members).toEqual([
      { kind: 'person', id: ROOKIE, name: 'Rookie', imageRef: 'people/rookie.png' },
    ]);
  });

  it('names a team’s wrestlers under the team', () => {
    const tag = segment({
      sides: [
        {
          name: 'The Pair',
          teamId: TEAM,
          isChampions: false,
          people: [
            { personId: ACE, name: 'Ace', imageRef: null },
            { personId: PARTNER, name: 'Partner', imageRef: null },
          ],
        },
      ],
    });
    expect(toRivalCardSlotProps(slot({ segment: tag })).sides[0]).toMatchObject({
      name: 'The Pair',
      detail: 'Ace & Partner',
    });
  });

  it('shows the winner, a draw or a no contest', () => {
    const won = slot({ segment: segment({ outcome: { kind: 'win', winningSide: 1 } }) });
    expect(toRivalCardSlotProps(won).winnerIndex).toBe(1);
    const drawn = slot({ segment: segment({ outcome: { kind: 'draw', winningSide: null } }) });
    expect(toRivalCardSlotProps(drawn)).toMatchObject({ resultLabel: 'Draw' });
    expect(toRivalCardSlotProps(drawn)).not.toHaveProperty('winnerIndex');
    const none = slot({ segment: segment({ outcome: { kind: 'noContest', winningSide: null } }) });
    expect(toRivalCardSlotProps(none)).toMatchObject({ resultLabel: 'No contest' });
  });

  it('leaves an open slot with no chips and no sides', () => {
    expect(toRivalCardSlotProps(slot({ segment: null, role: 'opener', displayNumber: 1 }))).toEqual(
      {
        slotRole: 'opener',
        slotNumber: 1,
        roleLabel: 'Main event',
        chips: [],
        sides: [],
      },
    );
  });

  it('keys slots by section and number', () => {
    expect(rivalSlotKey({ preShow: true, displayNumber: 1 })).toBe('pre-1');
    expect(rivalSlotKey({ preShow: false, displayNumber: 6 })).toBe('main-6');
  });
});
