/**
 * The shows system's setting (EVT10-01): **Show night**, Live or Auto, Live by default.
 *
 * Chosen at new game and changeable in Settings (`shows.setShowNight`). Stored by key in
 * `WorldMeta.settings.extra`, so there is no schema change, and `getSetting(read, 'showNight')`
 * gives the default `live` for a save from before it existed.
 *
 * The game stops on every one of the player's show days whichever is chosen (`shows.tonight`).
 * The setting only says how the show screen runs the show: Live, one match or segment at a time
 * with a report after each (`shows.runNextSegment`); Auto, all at once (`shows.runTonight`). Both
 * give the same results (docs/design/show-night.md#live-show-night).
 */

import { registerNewGameSetting, type NewGameSettingDef } from '../newgame/settings';

/** How the player's shows run from the show screen. */
export const SHOW_NIGHT_MODES = ['live', 'auto'] as const;
export type ShowNightMode = (typeof SHOW_NIGHT_MODES)[number];

declare module '../newgame/settings' {
  interface NewGameSettingMap {
    showNight: ShowNightMode;
  }
}

export const SHOW_NIGHT_SETTING: Readonly<NewGameSettingDef> = Object.freeze({
  key: 'showNight',
  kind: 'enum',
  options: [...SHOW_NIGHT_MODES],
  default: 'live',
  label: 'Show night',
  description:
    'Live: you run your shows one match or segment at a time and see how each went before the next. Auto: your shows run all at once. The results are the same either way.',
  group: 'world',
});

registerNewGameSetting(SHOW_NIGHT_SETTING);
