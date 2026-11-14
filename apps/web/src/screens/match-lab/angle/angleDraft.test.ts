import { describe, expect, it } from 'vitest';
import type { AngleTemplateOption, BeatOption, TunableRow } from '@ringside/engine';
import { parseContentKey, parseId } from '@ringside/engine';
import type { LabAngleDraft } from '../labStore';
import { EMPTY_ANGLE_DRAFT } from '../labStore';
import {
  angleArgsOf,
  angleBlocker,
  limitFromTunables,
  sameAngle,
  templateDrafts,
  UNKNOWN_LIMIT,
} from './angleDraft';

const PROMO: BeatOption = {
  key: parseContentKey('beat.promo'),
  name: 'Promo',
  description: '',
  groups: [
    {
      label: 'Speaker',
      stats: ['mic', 'charisma'],
      weight: 1,
      minPeople: 1,
      maxPeople: 4,
      optional: false,
      managerCanStandIn: true,
      roles: [],
    },
  ],
  physical: false,
  repetitionGroup: 'talk',
  weight: 1,
  settings: ['ring'],
};

const STAREDOWN: BeatOption = {
  ...PROMO,
  key: parseContentKey('beat.staredown'),
  name: 'Staredown',
  groups: [
    { ...PROMO.groups[0]!, label: 'Side A' },
    { ...PROMO.groups[0]!, label: 'Side B' },
  ],
};

const FEUD: AngleTemplateOption = {
  key: parseContentKey('template.feud-opener'),
  name: 'Feud Opener',
  angleTypeKey: parseContentKey('angle.confrontation'),
  purpose: 'startFeud',
  beats: [
    { beatKey: parseContentKey('beat.staredown'), groupOne: 'a', groupTwo: 'b', optional: true },
    {
      beatKey: parseContentKey('beat.war-of-words'),
      groupOne: 'a',
      groupTwo: 'b',
      optional: false,
    },
    { beatKey: parseContentKey('beat.brawl'), groupOne: 'ab', groupTwo: null, optional: false },
  ],
  requiredBeatCount: 2,
  setting: 'ring',
  description: null,
};

const REX = { id: parseId('person', 'per_0000000001'), name: 'Rex Halden' };
const JO = { id: parseId('person', 'per_0000000002'), name: 'Jo Vance' };

const SHOW = {
  slotRole: 'mainEvent',
  importance: 'regular',
  regionId: parseId('region', 'reg_0000000001'),
  televised: true,
  promotionId: parseId('promotion', 'pro_0000000001'),
} as const;

function draftOf(change: Partial<LabAngleDraft>): LabAngleDraft {
  return { ...EMPTY_ANGLE_DRAFT, angleTypeKey: parseContentKey('angle.promo'), ...change };
}

function blockerOf(draft: LabAngleDraft, max = 4): string | null {
  return angleBlocker({
    show: SHOW,
    draft,
    beatOptions: [PROMO, STAREDOWN],
    limit: { max, message: 'Short slot: up to 2 beats' },
    advancing: false,
    busyText: 'Wait for the day to finish',
  });
}

describe('templateDrafts', () => {
  it('drops optional beats from the front to fit, with every group empty', () => {
    expect(templateDrafts(FEUD, 2)?.map((beat) => beat.beatKey)).toEqual([
      'beat.war-of-words',
      'beat.brawl',
    ]);
    expect(templateDrafts(FEUD, 6)).toHaveLength(3);
    expect(templateDrafts(FEUD, 6)?.every((beat) => beat.groupOne.length === 0)).toBe(true);
    expect(templateDrafts(FEUD, 1)).toBeNull();
  });
});

describe('limitFromTunables', () => {
  it('reads the duration class’s maxBeats tunable, else the widest limit', () => {
    const rows: TunableRow[] = [
      {
        key: 'match.angle.maxBeats.short',
        category: 'Angles',
        kind: 'integer',
        unit: 'count',
        description: 'Most beats in a short slot',
        default: 2,
        value: 2,
        overridden: false,
      },
    ];
    expect(limitFromTunables('short', rows)).toEqual({
      max: 2,
      message: 'Short slot: up to 2 beats',
    });
    expect(limitFromTunables(undefined, rows)).toBe(UNKNOWN_LIMIT);
    expect(limitFromTunables('long', rows)).toBe(UNKNOWN_LIMIT);
  });
});

describe('angleBlocker', () => {
  it('names the first beat that needs someone, then the limit', () => {
    const empty = { id: 'beat-1', beatKey: 'beat.promo', groupOne: [], groupTwo: [] };
    expect(blockerOf(draftOf({ beats: [empty] }))).toBe('Add someone to beat 1 to run');
    const halfStaredown = {
      id: 'beat-2',
      beatKey: 'beat.staredown',
      groupOne: [REX],
      groupTwo: [],
    };
    expect(blockerOf(draftOf({ beats: [{ ...empty, groupOne: [REX] }, halfStaredown] }))).toBe(
      'Add someone to Side B in beat 2 to run',
    );
    const full = { ...empty, groupOne: [REX] };
    expect(blockerOf(draftOf({ beats: [full, full, full] }), 2)).toBe('Short slot: up to 2 beats');
    expect(blockerOf(draftOf({ beats: [full] }))).toBeNull();
  });
});

describe('angleArgsOf', () => {
  it('sends the beats by key and only the manager what-ifs of people in them', () => {
    const beats = [{ id: 'beat-1', beatKey: 'beat.promo', groupOne: [REX], groupTwo: [] }];
    const args = angleArgsOf(
      SHOW,
      draftOf({ beats, managerOverrides: { [REX.id]: null, [JO.id]: REX.id } }),
      [PROMO],
      7,
    );
    expect(args).toMatchObject({
      slotRole: 'mainEvent',
      angleTypeKey: 'angle.promo',
      beats: [{ beatKey: 'beat.promo', groupOne: [REX.id], groupTwo: [] }],
      managerOverrides: { [REX.id]: null },
      previewSeed: 7,
    });
    if (args === null) throw new Error('No args.');
    expect(sameAngle(args, { ...args, previewSeed: 9 })).toBe(true);
    expect(sameAngle(args, { ...args, slotRole: 'opener' })).toBe(false);
  });
});
