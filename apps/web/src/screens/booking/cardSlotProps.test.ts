import { describe, expect, it } from 'vitest';
import { parseContentKey, parseId } from '@ringside/engine';
import type {
  BookingIssue,
  BookingResultView,
  BookingSegmentView,
  BookingSlotView,
  TraceNode,
} from '@ringside/engine';
import { bookingSideText, issuesBySlot, toCardSlotProps } from './cardSlotProps';
import { defaultWinMethodKey, neighbourSlots } from './SlotActions';
import { withPendingMove } from './BookingView';

const TRACE: TraceNode = { kind: 'input', label: 'Slot', value: 3 };
const SEGMENT_ID = parseId('segment', 'seg_0000000001');

function person(serial: number, ringName: string) {
  return {
    personId: parseId('person', `per_000000000${String(serial)}`),
    ringName,
    imageRef: 'placeholder:person',
    role: 'competitor' as const,
    talkRole: null,
    availability: {
      status: 'available' as const,
      label: 'Available',
      reason: 'Available',
      until: null,
      canWorkAngles: true,
    },
    otherBrand: false,
  };
}

function segment(result: BookingResultView | null, sides = 2): BookingSegmentView {
  const names = ['Kai Moreno', 'Rhea Cortez', 'Tia Cruz', 'Max Dorn'];
  return {
    segmentId: SEGMENT_ID,
    kind: 'match',
    label: null,
    typeKey: 'match.triple-threat',
    typeName: 'Three-Way',
    durationShiftNote: null,
    titles: [
      {
        titleId: parseId('title', 'tit_0000000001'),
        name: 'Crown Title',
        holderCount: 1,
        imageRef: 'placeholder:title',
        holderIds: [],
      },
    ],
    sides: names.slice(0, sides).map((name, index) => ({
      side: index,
      name,
      teamId: null,
      people: [person(index + 1, name)],
    })),
    result,
    storylineIds: [],
    finishKey: null,
    stipulationKeys: [],
    setting: 'ring',
    talkLine: null,
    draft: {
      kind: 'angle',
      label: null,
      storylineIds: [],
      crew: { refereeId: null, producerId: null, announcerIds: [] },
      participants: [],
      angle: { angleTypeKey: parseContentKey('angle.promo') },
    },
  };
}

function slot(index: number, role: BookingSlotView['role'], filled: BookingSegmentView | null) {
  return {
    slot: index,
    displayNumber: index + 1,
    preShow: false,
    role,
    roleLabel: role === 'mainEvent' ? 'Main event' : 'Midcard',
    durationClass: 'standard' as const,
    durationLabel: 'Standard',
    weight: 1,
    roleTrace: TRACE,
    durationTrace: TRACE,
    weightTrace: TRACE,
    segment: filled,
  };
}

describe('toCardSlotProps', () => {
  it('maps an open slot to its role and number with no sides', () => {
    expect(toCardSlotProps(slot(5, 'mainEvent', null))).toEqual({
      slotRole: 'main-event',
      slotNumber: 6,
      roleLabel: 'Main event',
      chips: [],
      sides: [],
    });
  });

  it('maps a match: type and title chips, a side per side, and the planned winner', () => {
    const props = toCardSlotProps(
      slot(
        2,
        'midcard',
        segment(
          { kind: 'win', winningSide: 2, methodKey: 'method.pinfall', methodName: 'Pinfall' },
          3,
        ),
      ),
    );
    expect(props.slotRole).toBe('midcard');
    expect(props.chips.map((chip) => [chip.kind, chip.label])).toEqual([
      ['match-type', 'Three-Way'],
      ['title', 'Crown Title'],
    ]);
    expect(props.sides.map((side) => side.name)).toEqual(['Kai Moreno', 'Rhea Cortez', 'Tia Cruz']);
    expect(props.sides[0]?.members[0]).toMatchObject({ kind: 'person', name: 'Kai Moreno' });
    expect(props.winnerIndex).toBe(2);
    expect(props.resultLabel).toBeUndefined();
  });

  it("names a team's wrestlers under the team, and in the side's text", () => {
    const tagged = segment(null, 2);
    const [first] = tagged.sides;
    if (first === undefined) throw new Error('no side');
    const team = {
      ...first,
      name: 'Running Axe',
      teamId: parseId('team', 'tem_0000000001'),
      people: [person(1, 'Kai Moreno'), person(5, 'Rex Hale')],
    };
    const props = toCardSlotProps(
      slot(1, 'midcard', { ...tagged, sides: [team, ...tagged.sides.slice(1)] }),
    );
    expect(props.sides[0]).toMatchObject({ name: 'Running Axe', detail: 'Kai Moreno & Rex Hale' });
    // A side of individuals is already named by its people.
    expect(props.sides[1]?.detail).toBeUndefined();
    expect(bookingSideText(team)).toBe('Running Axe (Kai Moreno & Rex Hale)');
    expect(bookingSideText(first)).toBe('Kai Moreno');
  });

  it('words a draw and a no contest, with no winner', () => {
    const draw = { kind: 'draw' as const, winningSide: null, methodKey: null, methodName: null };
    expect(toCardSlotProps(slot(0, 'midcard', segment(draw))).resultLabel).toBe('Draw');
    expect(
      toCardSlotProps(slot(0, 'midcard', segment({ ...draw, kind: 'noContest' }))).resultLabel,
    ).toBe('No contest');
    expect(toCardSlotProps(slot(0, 'midcard', segment(draw))).winnerIndex).toBeUndefined();
  });

  it('shows Auto or Random where a planned winner would be', () => {
    const auto = { kind: 'auto' as const, winningSide: null, methodKey: null, methodName: null };
    const props = toCardSlotProps(slot(0, 'midcard', segment(auto)));
    expect(props.resultLabel).toBe('Auto');
    expect(props.winnerIndex).toBeUndefined();
    expect(
      toCardSlotProps(slot(0, 'midcard', segment({ ...auto, kind: 'random' }))).resultLabel,
    ).toBe('Random');
  });
});

describe('issuesBySlot', () => {
  it('counts errors and warnings per slot and leaves card-wide issues out', () => {
    const issue = (severity: 'error' | 'warning', where?: number): BookingIssue => ({
      checkId: 'booking.people',
      code: 'test',
      severity,
      message: 'Test',
      ...(where === undefined ? {} : { slot: { preShow: false, slot: where } }),
    });
    const counts = issuesBySlot(
      [issue('error', 2), issue('error', 2), issue('error')],
      [issue('warning', 2), issue('warning', 0)],
    );
    expect(counts.get('main-2')).toEqual({ errors: 2, warnings: 1 });
    expect(counts.get('main-0')).toEqual({ errors: 0, warnings: 1 });
    expect(counts.size).toBe(2);
  });
});

describe('defaultWinMethodKey', () => {
  const method = (key: string, changesTitles: boolean) => ({
    key: parseContentKey(key),
    name: key,
    changesTitles,
  });

  it("takes the type's first title-changing method", () => {
    const finishes = [
      { methods: [method('method.count-out', false)] },
      { methods: [method('method.submission', true), method('method.pinfall', true)] },
    ];
    expect(defaultWinMethodKey(finishes, undefined)).toBe('method.submission');
  });

  it("falls back to the catalog's first title-changing method", () => {
    const catalog = {
      matchTypes: [],
      beats: [],
      angleTemplates: [],
      angleTypes: [],
      available: true,
      methods: [
        {
          key: parseContentKey('method.count-out'),
          name: 'Count-out',
          order: 1,
          changesTitles: false,
          hidden: false,
        },
        {
          key: parseContentKey('method.knockout'),
          name: 'Knockout',
          order: 3,
          changesTitles: true,
          hidden: false,
        },
        {
          key: parseContentKey('method.pinfall'),
          name: 'Pinfall',
          order: 2,
          changesTitles: true,
          hidden: false,
        },
        {
          key: parseContentKey('method.secret'),
          name: 'Secret',
          order: 0,
          changesTitles: true,
          hidden: true,
        },
      ],
    };
    expect(defaultWinMethodKey([], catalog)).toBe('method.pinfall');
    expect(defaultWinMethodKey(undefined, undefined)).toBeNull();
  });
});

describe('moves', () => {
  const section = {
    preShow: false,
    slots: [
      slot(0, 'midcard', segment(null)),
      slot(1, 'midcard', null),
      slot(2, 'mainEvent', null),
    ],
  };

  it('finds the slots above and below, open or not', () => {
    const middle = section.slots[1];
    if (middle === undefined) throw new Error('No middle slot');
    expect(neighbourSlots(middle, section).up?.slot).toBe(0);
    expect(neighbourSlots(middle, section).down?.slot).toBe(2);
    const first = section.slots[0];
    if (first === undefined) throw new Error('No first slot');
    expect(neighbourSlots(first, section).up).toBeNull();
  });

  it('draws a pending move as a swap without touching the card it was given', () => {
    const moved = withPendingMove([section], {
      preShow: false,
      fromSlot: 0,
      toSlot: 2,
      baseRevision: 1,
    });
    expect(moved[0]?.slots.map((entry) => entry.segment === null)).toEqual([true, true, false]);
    expect(section.slots[0]?.segment).not.toBeNull();
    expect(withPendingMove([section], null)[0]).toBe(section);
  });
});
