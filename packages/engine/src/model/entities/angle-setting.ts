/**
 * Where a talking segment happens (MTCH5-08): in the ring in front of the crowd, backstage, or as a
 * pre-taped video. A leaf module with no imports so the catalogs, the segment table and the
 * participants can all read it without an import cycle.
 *
 * - `ring`: the default, live in front of the crowd;
 * - `backstage`: the locker room, an office, the car park; the crowd watches on screen;
 * - `video`: pre-taped and played on the screen.
 *
 * Design notes: docs/design/angle-rating.md#settings.
 */

export const ANGLE_SETTINGS = ['ring', 'backstage', 'video'] as const;
export type AngleSetting = (typeof ANGLE_SETTINGS)[number];

/** The setting a stored angle has when it names none: saves from before MTCH5-08. */
export const DEFAULT_ANGLE_SETTING: AngleSetting = 'ring';

/** Player words for each setting: the booking choice and the card line. */
export const ANGLE_SETTING_LABELS: Readonly<Record<AngleSetting, string>> = {
  ring: 'In the ring',
  backstage: 'Backstage',
  video: 'Pre-taped',
};

/** True for the settings away from the live crowd. */
export function isOffCrowdSetting(setting: AngleSetting): boolean {
  return setting !== 'ring';
}

/**
 * The parts someone plays in a talking segment (MTCH5-08). Stored as `talkRole` on a speaker;
 * a speaker with none is a wrestler (saves from before MTCH5-08).
 *
 * - `wrestler`: talks for themselves;
 * - `manager`: speaks for or stands with a client (`forPersonId`);
 * - `interviewer`: hosts an interview or reads an announcement;
 * - `authority`: an on-screen general manager or owner figure.
 */
export const TALK_ROLES = ['wrestler', 'manager', 'interviewer', 'authority'] as const;
export type TalkRole = (typeof TALK_ROLES)[number];

/** The talk role a speaker with none has. */
export const DEFAULT_TALK_ROLE: TalkRole = 'wrestler';

/** Player words for each talk role. */
export const TALK_ROLE_LABELS: Readonly<Record<TalkRole, string>> = {
  wrestler: 'Wrestler',
  manager: 'Manager',
  interviewer: 'Interviewer',
  authority: 'Authority figure',
};
