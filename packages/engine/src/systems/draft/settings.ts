/**
 * The draft-start new-game settings (DRF-01, DRF-03, DRF-07), in the wizard's `draft` group.
 *
 * Settings are flat booleans and enums (the registry's two kinds), so the draft's options are seven
 * keys; {@link draftSettingsOf} reads them back as one object. Every one is stored only when it
 * differs from its default, so a game without a draft stores exactly what it stored before.
 *
 * | Key                   | Kind    | Default | Options                                   |
 * | --------------------- | ------- | ------- | ----------------------------------------- |
 * | `draftStart`          | boolean | false   |                                           |
 * | `draftRosterSize`     | enum    | `auto`  | `auto`, `10`, `15`, `20`, `25`, `30`, `40` |
 * | `draftPoolSize`       | enum    | `auto`  | `auto`, `small`, `large`, `all`           |
 * | `draftOrder`          | enum    | `snake` | `snake`, `random`, `bySize`               |
 * | `draftStaff`          | boolean | false   |                                           |
 * | `draftNegotiateAfter` | boolean | false   |                                           |
 * | `draftSchedule`       | enum    | `weekly`| `weekly`, `open`                          |
 *
 * Design: docs/design/draft.md#settings.
 */

import type { GameWorldView } from '../../model/tables';
import type { DraftOrder, DraftSchedule } from '../../model/entities/draft';
import {
  getSetting,
  registerNewGameSetting,
  type NewGameSettingDef,
  type ResolvedNewGameSettings,
} from '../newgame/settings';

export const DRAFT_ROSTER_SIZES = ['auto', '10', '15', '20', '25', '30', '40'] as const;
export type DraftRosterSize = (typeof DRAFT_ROSTER_SIZES)[number];

export const DRAFT_POOL_SIZES = ['auto', 'small', 'large', 'all'] as const;
export type DraftPoolSize = (typeof DRAFT_POOL_SIZES)[number];

declare module '../newgame/settings' {
  interface NewGameSettingMap {
    draftStart: boolean;
    draftRosterSize: DraftRosterSize;
    draftPoolSize: DraftPoolSize;
    draftOrder: DraftOrder;
    draftStaff: boolean;
    draftNegotiateAfter: boolean;
    draftSchedule: DraftSchedule;
  }
}

/** The draft settings, registered in this order. */
export const DRAFT_SETTINGS: readonly NewGameSettingDef[] = [
  {
    key: 'draftStart',
    kind: 'boolean',
    default: false,
    label: 'Start with a draft',
    description:
      'Every wrestler starts in a free-agent pool and the promotions draft them before day 1. Every promotion starts with the same money and popularity, no TV deal and every title vacant.',
    group: 'draft',
  },
  {
    key: 'draftRosterSize',
    kind: 'enum',
    options: [...DRAFT_ROSTER_SIZES],
    default: 'auto',
    label: 'Roster size',
    description:
      'Wrestlers each promotion drafts. Auto drafts 20, or fewer when the world has fewer wrestlers per promotion.',
    group: 'draft',
    requires: 'draftStart',
  },
  {
    key: 'draftPoolSize',
    kind: 'enum',
    options: [...DRAFT_POOL_SIZES],
    default: 'auto',
    label: 'Pool size',
    description:
      'How many wrestlers can be drafted: Auto is a quarter more than the promotions need, Small a little more, Large plenty more, All everyone. Wrestlers left out sit out at the start.',
    group: 'draft',
    requires: 'draftStart',
  },
  {
    key: 'draftOrder',
    kind: 'enum',
    options: ['snake', 'random', 'bySize'],
    default: 'snake',
    label: 'Draft order',
    description:
      'Snake: a random first round, then the order reverses every round. Random: a new random order every round. By size: the smallest promotion picks first every round.',
    group: 'draft',
    requires: 'draftStart',
  },
  {
    key: 'draftStaff',
    kind: 'boolean',
    default: false,
    label: 'Draft staff too',
    description:
      'Managers, announcers, referees and the rest are drafted as well. Off: staff stay where they are.',
    group: 'draft',
    requires: 'draftStart',
  },
  {
    key: 'draftNegotiateAfter',
    kind: 'boolean',
    default: false,
    label: 'Negotiate contracts after the draft',
    description:
      'Off: a pick signs a one-season contract priced by their value. On: picks join unsigned, reserved for you for a while, and you negotiate with each one or release them.',
    group: 'draft',
    requires: 'draftStart',
  },
  {
    key: 'draftSchedule',
    kind: 'enum',
    options: ['weekly', 'open'],
    default: 'weekly',
    label: 'Show schedule',
    description:
      'One show a week: every promotion runs one weekly show. Open: every promotion starts with one weekly show and may add as many as it can afford.',
    group: 'draft',
    requires: 'draftStart',
  },
];

for (const def of DRAFT_SETTINGS) {
  registerNewGameSetting(def, { storeDefault: false });
}

/** The draft settings as one object, the shape `draft.preview` and the docs use. */
export interface DraftOptions {
  enabled: boolean;
  rosterSize: DraftRosterSize;
  poolSize: DraftPoolSize;
  order: DraftOrder;
  draftStaff: boolean;
  negotiateAfter: boolean;
  schedule: DraftSchedule;
}

/** The world's draft settings. */
export function draftSettingsOf(read: Pick<GameWorldView, 'meta'>): DraftOptions {
  return {
    enabled: getSetting(read, 'draftStart'),
    rosterSize: getSetting(read, 'draftRosterSize'),
    poolSize: getSetting(read, 'draftPoolSize'),
    order: getSetting(read, 'draftOrder'),
    draftStaff: getSetting(read, 'draftStaff'),
    negotiateAfter: getSetting(read, 'draftNegotiateAfter'),
    schedule: getSetting(read, 'draftSchedule'),
  };
}

function enumOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

/** The draft settings from a new game's resolved settings (before they are stored). */
export function draftOptionsFrom(settings: ResolvedNewGameSettings): DraftOptions {
  return {
    enabled: settings['draftStart'] === true,
    rosterSize: enumOf(settings['draftRosterSize'], DRAFT_ROSTER_SIZES, 'auto'),
    poolSize: enumOf(settings['draftPoolSize'], DRAFT_POOL_SIZES, 'auto'),
    order: enumOf<DraftOrder>(settings['draftOrder'], ['snake', 'random', 'bySize'], 'snake'),
    draftStaff: settings['draftStaff'] === true,
    negotiateAfter: settings['draftNegotiateAfter'] === true,
    schedule: enumOf<DraftSchedule>(settings['draftSchedule'], ['weekly', 'open'], 'weekly'),
  };
}
