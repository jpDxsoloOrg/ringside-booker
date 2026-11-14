/**
 * Talk roles and settings for talking segments (MTCH5-08): who plays which part, and where an angle
 * happens. Catalog readings and plain words only; the rating side lives in `formulas/angleScore.ts`
 * and `rateAngle.ts`, the booking warnings in `booking/validate/checks/talk.ts`.
 *
 * - A beat group may list the talk roles that suit it (`roles`); none listed = anyone suits it.
 * - An angle type and a beat may list the settings they allow (`settings`); none = every setting.
 * - Employment roles map to the talk role someone plays by default: a presenter or announcer
 *   interviews, a manager manages, everyone else is a wrestler.
 *
 * Design: docs/design/angle-rating.md#talk-roles and #settings.
 */

import type { EmploymentRole } from '../../../model/entities/employment';
import type { PersonRole } from '../../../model/entities/person';
import {
  ANGLE_SETTINGS,
  ANGLE_SETTING_LABELS,
  DEFAULT_ANGLE_SETTING,
  TALK_ROLE_LABELS,
  type AngleSetting,
  type TalkRole,
} from '../../../model/entities/angle-setting';
import type { DurationShift, MatchTypeDef } from '../../../model/catalogs';
import type { EngineTunables } from '../../tunables';

/** Where an angle type may happen: its own list, or every setting. */
export function settingsOfAngleType(angleType: {
  readonly settings?: readonly AngleSetting[] | undefined;
}): AngleSetting[] {
  return angleType.settings === undefined ? [...ANGLE_SETTINGS] : [...angleType.settings];
}

/** Whether a beat (or an angle type) may happen in `setting`. None listed = everywhere. */
export function allowsSetting(
  entry: { readonly settings?: readonly AngleSetting[] | undefined },
  setting: AngleSetting,
): boolean {
  return entry.settings === undefined || entry.settings.includes(setting);
}

/**
 * The setting a new angle of a type starts in: the ring when the type allows it, otherwise its
 * first setting (a video package is pre-taped).
 */
export function defaultSettingOf(angleType: {
  readonly settings?: readonly AngleSetting[] | undefined;
}): AngleSetting {
  const settings = settingsOfAngleType(angleType);
  return settings.includes(DEFAULT_ANGLE_SETTING)
    ? DEFAULT_ANGLE_SETTING
    : (settings[0] ?? DEFAULT_ANGLE_SETTING);
}

/** Whether a talk role suits a beat group. A group listing no roles suits everyone. */
export function groupAllowsRole(
  group: { readonly roles?: readonly TalkRole[] | undefined },
  role: TalkRole,
): boolean {
  return group.roles === undefined || group.roles.includes(role);
}

/** The talk role someone hired as `employmentRole` plays by default. */
export function talkRoleForEmployment(employmentRole: EmploymentRole | PersonRole): TalkRole {
  if (employmentRole === 'manager') {
    return 'manager';
  }
  return employmentRole === 'presenter' || employmentRole === 'announcer'
    ? 'interviewer'
    : 'wrestler';
}

/** "Interviewer", "Wrestler or manager", "Interviewer, authority figure or manager". */
export function rolesText(roles: readonly TalkRole[]): string {
  const words = roles.map((role, index) =>
    index === 0 ? TALK_ROLE_LABELS[role] : TALK_ROLE_LABELS[role].toLowerCase(),
  );
  if (words.length <= 1) {
    return words[0] ?? '';
  }
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1] ?? ''}`;
}

/** "an interviewer", "a wrestler or manager": a role list in a sentence. */
export function rolesPhrase(roles: readonly TalkRole[]): string {
  const text = rolesText(roles).toLowerCase();
  return `${/^[aeiou]/u.test(text) ? 'an' : 'a'} ${text}`;
}

const SETTING_NOTES: Readonly<Record<AngleSetting, string | null>> = {
  ring: null,
  backstage: 'Backstage: the crowd watches on screen',
  video: 'Pre-taped: the crowd watches on screen',
};

/** The note the angle's Why? starts with in a setting away from the live crowd. */
export function settingNote(setting: AngleSetting): string | null {
  return SETTING_NOTES[setting];
}

/** "Backstage", "Pre-taped", "In the ring". */
export function settingLabel(setting: AngleSetting): string {
  return ANGLE_SETTING_LABELS[setting];
}

/** The tunable holding a setting's crowd share. */
export type SettingCrowdShareKey =
  `match.angle.setting.${Exclude<AngleSetting, 'ring'>}.crowdShare`;
/** The tunable holding a setting's duration shift. */
export type SettingDurationShiftKey =
  `match.angle.setting.${Exclude<AngleSetting, 'ring'>}.durationShift`;

export function settingCrowdShareKey(setting: Exclude<AngleSetting, 'ring'>): SettingCrowdShareKey {
  return `match.angle.setting.${setting}.crowdShare`;
}

export function settingDurationShiftKey(
  setting: Exclude<AngleSetting, 'ring'>,
): SettingDurationShiftKey {
  return `match.angle.setting.${setting}.durationShift`;
}

/**
 * What moves a talking segment's duration class: nothing in the ring; backstage and pre-taped
 * segments shift by their `match.angle.setting.<setting>.durationShift` (a backstage segment is
 * usually short). Shaped like a match type so `durationClassOf` explains it the same way:
 * "Backstage pulls it down a step → Short".
 */
export function settingDurationShifter(
  setting: AngleSetting,
  tunables: EngineTunables,
): Pick<MatchTypeDef, 'name' | 'durationShift'> | null {
  if (setting === 'ring') {
    return null;
  }
  const shift = tunables.get(settingDurationShiftKey(setting));
  const durationShift: DurationShift = shift < 0 ? -1 : shift > 0 ? 1 : 0;
  return { name: settingLabel(setting), durationShift };
}
