/**
 * The match system's new-game setting (MTCH2-03): **Random winners**, off by default.
 *
 * Registered once at module load (the match system's `index.ts` imports this file). The value is
 * stored by key in `WorldMeta.settings.extra`, so there is no schema change, and
 * `getSetting(read, 'randomWinners')` gives the default `false` for a save from before it existed.
 * Whether it applies to a show is `randomWinnersActive` (`finishes/randomWinners.ts`).
 *
 * Design: docs/design/match-finishes.md#random-winners.
 */

import { registerNewGameSetting, type NewGameSettingDef } from '../newgame/settings';

declare module '../newgame/settings' {
  interface NewGameSettingMap {
    randomWinners: boolean;
  }
}

export const RANDOM_WINNERS_SETTING: Readonly<NewGameSettingDef> = Object.freeze({
  key: 'randomWinners',
  kind: 'boolean',
  default: false,
  label: 'Random winners',
  description:
    'You book every match on your shows, but not who wins: each result is decided on the night. Rival promotions book their own results.',
  group: 'difficulty',
});

registerNewGameSetting(RANDOM_WINNERS_SETTING);
