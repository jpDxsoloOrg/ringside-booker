/**
 * Talk-role and setting warnings for a talking segment (MTCH5-08). Every one is a warning, never an
 * error: the booker may put anyone anywhere, and nothing here changes a rating (no role or style
 * penalty).
 *
 * - `angle.settingNotAllowed`: the angle type is not offered in this setting ("A Video Package
 *   can't happen in the ring").
 * - `angle.beatSettingNotAllowed`: a beat cannot happen in this setting ("Car Park Ambush can't
 *   happen in the ring").
 * - `angle.wrongRole`: someone's part does not suit their beat group ("Kai Moreno is a wrestler:
 *   Host is for an interviewer").
 * - `angle.clientNotInSegment`: a manager is booked for a client who is not in the segment.
 *
 * The booking checklist (`booking/validate/checks/talk.ts`) and the lab's `segmentWarnings` both
 * read this one function. Design: docs/design/angle-rating.md#talk-roles.
 */

import type { ContentKey } from '../../../core/content-key';
import type { PersonId } from '../../../core/ids';
import type { AngleTypeDef, BeatDef } from '../../../model/catalogs';
import {
  TALK_ROLE_LABELS,
  type AngleSetting,
  type TalkRole,
} from '../../../model/entities/angle-setting';
import { allowsSetting, groupAllowsRole, rolesPhrase } from './settings';

export const TALK_WARNING_CODES = [
  'angle.settingNotAllowed',
  'angle.beatSettingNotAllowed',
  'angle.wrongRole',
  'angle.clientNotInSegment',
] as const;
export type TalkWarningCode = (typeof TALK_WARNING_CODES)[number];

/** One person's part in the segment. */
export interface TalkPart {
  readonly talkRole: TalkRole;
  /** The client a manager is there for. */
  readonly forPersonId?: PersonId | undefined;
}

/** One beat with its two groups, as `beatGroupsOf` splits it. */
export interface TalkCheckBeat {
  readonly beatKey: ContentKey;
  readonly groupOne: readonly PersonId[];
  readonly groupTwo: readonly PersonId[];
}

export interface TalkCheckInput {
  readonly angleType: Pick<AngleTypeDef, 'name'> & {
    readonly settings?: readonly AngleSetting[] | undefined;
  };
  readonly setting: AngleSetting;
  readonly beats: readonly TalkCheckBeat[];
  /** Everyone's part; someone missing is a wrestler. */
  readonly parts: ReadonlyMap<PersonId, TalkPart>;
  readonly beatOf: (beatKey: ContentKey) => BeatDef | undefined;
  readonly nameOf: (personId: PersonId) => string;
}

export interface TalkWarning {
  readonly code: TalkWarningCode;
  readonly message: string;
  readonly personId?: PersonId;
  /** The 0-based beat the warning is about. */
  readonly beatIndex?: number;
}

/** "in the ring", "backstage", "as a pre-taped video". */
export function settingPhrase(setting: AngleSetting): string {
  return SETTING_PHRASES[setting];
}

const SETTING_PHRASES: Readonly<Record<AngleSetting, string>> = {
  ring: 'in the ring',
  backstage: 'backstage',
  video: 'as a pre-taped video',
};

/** "A Video Package can't happen in the ring". */
export function settingNotAllowedMessage(typeName: string, setting: AngleSetting): string {
  const article = /^[aeiou]/i.test(typeName) ? 'An' : 'A';
  return `${article} ${typeName} can't happen ${settingPhrase(setting)}`;
}

/** "Car Park Ambush can't happen in the ring". */
export function beatSettingMessage(beatName: string, setting: AngleSetting): string {
  return `${beatName} can't happen ${settingPhrase(setting)}`;
}

/** "Kai Moreno is a wrestler: Host is for an interviewer". */
export function wrongRoleMessage(
  name: string,
  role: TalkRole,
  groupLabel: string,
  roles: readonly TalkRole[],
): string {
  const label = TALK_ROLE_LABELS[role].toLowerCase();
  const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
  return `${name} is ${article} ${label}: ${groupLabel} is for ${rolesPhrase(roles)}`;
}

/** "Victor Crane is here for Kai Moreno, who isn't in this segment". */
export function clientMissingMessage(managerName: string, clientName: string): string {
  return `${managerName} is here for ${clientName}, who isn't in this segment`;
}

/** Every talk-role and setting warning, in beat, group and person order. */
export function talkWarnings(input: TalkCheckInput): TalkWarning[] {
  const warnings: TalkWarning[] = [];
  const partOf = (personId: PersonId): TalkPart =>
    input.parts.get(personId) ?? { talkRole: 'wrestler' };

  if (!allowsSetting(input.angleType, input.setting)) {
    warnings.push({
      code: 'angle.settingNotAllowed',
      message: settingNotAllowedMessage(input.angleType.name, input.setting),
    });
  }

  const inSegment = new Set<PersonId>();
  const warnedRole = new Set<PersonId>();
  input.beats.forEach((beat, beatIndex) => {
    const def = input.beatOf(beat.beatKey);
    if (def === undefined) {
      return;
    }
    if (!allowsSetting(def, input.setting)) {
      warnings.push({
        code: 'angle.beatSettingNotAllowed',
        message: beatSettingMessage(def.name, input.setting),
        beatIndex,
      });
    }
    const twoGroups = def.groups.length > 1;
    def.groups.forEach((group, groupIndex) => {
      const people =
        groupIndex === 0
          ? twoGroups
            ? beat.groupOne
            : [...beat.groupOne, ...beat.groupTwo]
          : beat.groupTwo;
      for (const personId of people) {
        inSegment.add(personId);
        const role = partOf(personId).talkRole;
        if (group.roles === undefined || groupAllowsRole(group, role) || warnedRole.has(personId)) {
          continue;
        }
        warnedRole.add(personId);
        warnings.push({
          code: 'angle.wrongRole',
          message: wrongRoleMessage(input.nameOf(personId), role, group.label, group.roles),
          personId,
          beatIndex,
        });
      }
    });
  });

  for (const [personId, part] of input.parts) {
    if (
      part.talkRole === 'manager' &&
      part.forPersonId !== undefined &&
      inSegment.has(personId) &&
      !inSegment.has(part.forPersonId)
    ) {
      warnings.push({
        code: 'angle.clientNotInSegment',
        message: clientMissingMessage(input.nameOf(personId), input.nameOf(part.forPersonId)),
        personId,
      });
    }
  }
  return warnings;
}
