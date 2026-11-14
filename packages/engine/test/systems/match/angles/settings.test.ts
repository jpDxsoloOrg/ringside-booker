// Talk roles and settings (MTCH5-08): rating by setting, the role and setting warnings and the
// talk line. Design: docs/design/angle-rating.md#talk-roles and #settings.
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../../src/core/content-key';
import type { PersonId } from '../../../../src/core/ids';
import { findTraceNodes, type TraceNode } from '../../../../src/core/trace';
import { beatOf, type AngleTypeDef } from '../../../../src/model/catalogs';
import {
  defaultSettingOf,
  rolesText,
  settingsOfAngleType,
  talkRoleForEmployment,
} from '../../../../src/systems/match/angles/settings';
import { talkLine } from '../../../../src/systems/match/angles/talkLine';
import { talkWarnings, type TalkPart } from '../../../../src/systems/match/angles/talkWarnings';
import { angleWorld, beatArgs, previewAngle, promoArgs, PROMO } from './angle-world';
import { testId } from '../../../support/ids';

const INTERVIEW_TYPE = parseContentKey('angle.interview');
const INTERVIEW = parseContentKey('beat.interview');
const PARKING_LOT = parseContentKey('beat.parking-lot-attack');

function labels(node: TraceNode): string[] {
  return findTraceNodes(node, 'note').map((found) => found.label);
}

describe('rating by setting', () => {
  it('leans on the beats backstage: a smaller crowd share, no crowd roll, the setting note', () => {
    const setup = angleWorld();
    const ring = previewAngle(setup, promoArgs(setup));
    const backstage = previewAngle(setup, promoArgs(setup, { setting: 'backstage' }));

    expect(labels(backstage.score.trace)).toContain('Backstage: the crowd watches on screen');
    expect(labels(ring.score.trace)).not.toContain('Backstage: the crowd watches on screen');
    const crowdLine = (trace: typeof ring.score.trace): string | undefined =>
      trace.children?.find((child) => child.label.startsWith('Crowd ×'))?.label;
    // 0.35 × 0.4 = 0.14 of the score from the crowd backstage.
    expect(crowdLine(ring.score.trace)).toBe('Crowd × 0.35');
    expect(crowdLine(backstage.score.trace)).toBe('Crowd × 0.14');
    expect(findTraceNodes(ring.crowd.trace, 'roll')).toHaveLength(1);
    expect(findTraceNodes(backstage.crowd.trace, 'roll')).toHaveLength(0);
    // The beats are rated the same way in both settings.
    expect(backstage.delivered.value).toBe(ring.delivered.value);
  });

  it('makes a backstage segment one step shorter, and a pre-taped one keeps its class', () => {
    const setup = angleWorld();
    expect(previewAngle(setup, promoArgs(setup)).durationClass).toBe('standard');
    const backstage = previewAngle(setup, promoArgs(setup, { setting: 'backstage' }));
    expect(backstage.durationClass).toBe('short');
    expect(backstage.beatLimit.max).toBe(2);
    expect(previewAngle(setup, promoArgs(setup, { setting: 'video' })).durationClass).toBe(
      'standard',
    );
  });

  it('warns, never refuses, when the type or a beat cannot happen in the setting', () => {
    const setup = angleWorld();
    const result = previewAngle(
      setup,
      promoArgs(setup, {
        angleTypeKey: parseContentKey('angle.attack'),
        beats: [beatArgs(PARKING_LOT, [setup.wrestlers[0]], [setup.wrestlers[1]])],
      }),
    );
    expect(result.warnings.map((warning) => [warning.code, warning.message])).toContainEqual([
      'angle.beatSettingNotAllowed',
      "Car Park Ambush can't happen in the ring",
    ]);
  });

  it('warns about a wrestler as an interview host from the role they were hired for', () => {
    const setup = angleWorld();
    const result = previewAngle(
      setup,
      promoArgs(setup, {
        angleTypeKey: INTERVIEW_TYPE,
        beats: [beatArgs(INTERVIEW, [setup.wrestlers[0]], [setup.wrestlers[1]])],
      }),
    );
    const wrongRole = result.warnings.filter((warning) => warning.code === 'angle.wrongRole');
    expect(wrongRole).toHaveLength(1);
    expect(wrongRole[0]?.severity).toBe('warning');
    expect(wrongRole[0]?.message).toMatch(/ is a wrestler: Host is for an interviewer$/);
    expect(result.score.value).toBeGreaterThan(0);
  });

  it('keeps a manager on the guest side quiet', () => {
    const setup = angleWorld();
    const result = previewAngle(
      setup,
      promoArgs(setup, {
        beats: [beatArgs(PROMO, [setup.wrestlers[0], setup.manager])],
      }),
    );
    expect(result.warnings.filter((warning) => warning.code === 'angle.wrongRole')).toEqual([]);
  });
});

describe('talkWarnings', () => {
  const kai = testId('person', 1);
  const lena = testId('person', 2);
  const victor = testId('person', 3);
  const rex = testId('person', 4);
  const names: Record<string, string> = {
    [kai]: 'Kai Moreno',
    [lena]: 'Lena Park',
    [victor]: 'Victor Crane',
    [rex]: 'Rex Hale',
  };
  const setup = angleWorld();
  const interviewType: Pick<AngleTypeDef, 'name' | 'settings'> = {
    name: 'Interview',
    settings: ['ring', 'backstage', 'video'],
  };

  function check(
    parts: Record<string, TalkPart>,
    groupOne: PersonId[],
    groupTwo: PersonId[],
    setting: 'ring' | 'backstage' | 'video' = 'backstage',
    angleType: Pick<AngleTypeDef, 'name' | 'settings'> = interviewType,
  ) {
    return talkWarnings({
      angleType,
      setting,
      beats: [{ beatKey: INTERVIEW, groupOne, groupTwo }],
      parts: new Map(
        [kai, lena, victor, rex].flatMap((personId): [PersonId, TalkPart][] => {
          const part = parts[personId];
          return part === undefined ? [] : [[personId, part]];
        }),
      ),
      beatOf: (beatKey) => beatOf(setup.world, beatKey),
      nameOf: (personId) => names[personId] ?? personId,
    });
  }

  it('is quiet for an interviewer, a wrestler and his manager backstage', () => {
    expect(
      check(
        {
          [lena]: { talkRole: 'interviewer' },
          [kai]: { talkRole: 'wrestler' },
          [victor]: { talkRole: 'manager', forPersonId: kai },
        },
        [kai, victor],
        [lena],
      ),
    ).toEqual([]);
  });

  it('flags each wrong part once, a missing client and a setting the type does not allow', () => {
    const warnings = check(
      {
        [rex]: { talkRole: 'wrestler' },
        [kai]: { talkRole: 'interviewer' },
        [victor]: { talkRole: 'manager', forPersonId: lena },
      },
      [kai, victor],
      [rex],
      'video',
      { name: 'Attack', settings: ['ring', 'backstage'] },
    );
    expect(warnings.map((warning) => [warning.code, warning.message])).toEqual([
      ['angle.settingNotAllowed', "An Attack can't happen as a pre-taped video"],
      ['angle.wrongRole', 'Kai Moreno is an interviewer: Guest is for a wrestler or manager'],
      ['angle.wrongRole', 'Rex Hale is a wrestler: Host is for an interviewer'],
      ['angle.clientNotInSegment', "Victor Crane is here for Lena Park, who isn't in this segment"],
    ]);
  });
});

describe('talkLine', () => {
  const ids = new Map<string, PersonId>();
  const idOf = (name: string): PersonId => {
    let id = ids.get(name);
    if (id === undefined) {
      id = testId('person', ids.size + 1);
      ids.set(name, id);
    }
    return id;
  };
  const person = (
    name: string,
    talkRole: TalkPart['talkRole'],
    forName?: string,
  ): Parameters<typeof talkLine>[1][number] => ({
    personId: idOf(name),
    name,
    talkRole,
    ...(forName === undefined ? {} : { forPersonId: idOf(forName) }),
  });

  it('names who interviews whom, with their manager, and where', () => {
    expect(
      talkLine('backstage', [
        person('Kai Moreno', 'wrestler'),
        person('Victor Crane', 'manager', 'Kai Moreno'),
        person('Lena Park', 'interviewer'),
      ]),
    ).toBe('Backstage: Lena Park interviews Kai Moreno (with Victor Crane)');
  });

  it('has an authority figure meet people, and plural verbs', () => {
    expect(
      talkLine('ring', [
        person('The Boss', 'authority'),
        person('Kai Moreno', 'wrestler'),
        person('Rex Hale', 'wrestler'),
      ]),
    ).toBe('The Boss meets Kai Moreno and Rex Hale');
    expect(
      talkLine('video', [
        person('Lena Park', 'interviewer'),
        person('Ana Diaz', 'interviewer'),
        person('Kai Moreno', 'wrestler'),
      ]),
    ).toBe('Pre-taped: Lena Park and Ana Diaz interview Kai Moreno');
  });

  it('leaves a ring segment of wrestlers alone, and lists a manager without a client', () => {
    expect(talkLine('ring', [person('Kai Moreno', 'wrestler')])).toBeNull();
    expect(
      talkLine('backstage', [
        person('Kai Moreno', 'wrestler'),
        person('Victor Crane', 'manager', 'Rex Hale'),
      ]),
    ).toBe('Backstage: Kai Moreno and Victor Crane');
  });
});

describe('setting and role helpers', () => {
  it('starts a type in the ring when it can, else in its first setting', () => {
    expect(defaultSettingOf({})).toBe('ring');
    expect(defaultSettingOf({ settings: ['video'] })).toBe('video');
    expect(settingsOfAngleType({})).toEqual(['ring', 'backstage', 'video']);
  });

  it('maps hiring roles to parts and lists roles in plain words', () => {
    expect(talkRoleForEmployment('presenter')).toBe('interviewer');
    expect(talkRoleForEmployment('announcer')).toBe('interviewer');
    expect(talkRoleForEmployment('manager')).toBe('manager');
    expect(talkRoleForEmployment('wrestler')).toBe('wrestler');
    expect(rolesText(['interviewer', 'authority'])).toBe('Interviewer or authority figure');
  });
});
