import { create } from 'zustand';
import type { FoundingSize, PromotionStyle, SeasonPresetKey, Weekday } from '@ringside/engine';
import type { WizardField, WizardIssue } from './issues';

/**
 * The new-game wizard's draft: every choice the player has made so far. UI state only; the world
 * preview it is checked against comes from the engine and is not kept here.
 *
 * Fields left at null mean "use what the preview suggests": the default season preset, the world
 * pack's start date, the save name built from the promotion's short name and start year.
 *
 * The last used settings and player name are remembered in `localStorage` once a game starts, as a
 * convenience for the next new game. Storage can be missing or throw (a private window, blocked
 * site data), so every read and write is guarded and the wizard works the same without it.
 */

export type PlayerMode = 'existing' | 'found';

/** The founding form, as typed. The engine checks and normalises it (upper-cased short name). */
export interface FoundFormValues {
  readonly name: string;
  readonly shortName: string;
  /** The region picker's first two levels; only the region itself is sent. */
  readonly continentKey: string;
  readonly countryKey: string;
  readonly homeRegionKey: string;
  readonly style: PromotionStyle | null;
  readonly size: FoundingSize;
  /** `#rrggbb`. */
  readonly color: string;
  readonly starterKit: boolean;
  readonly weeklyShowDay: Weekday;
}

export interface PlayerDraft {
  readonly mode: PlayerMode;
  /** The pack key of the promotion to take over, when `mode` is `existing`. */
  readonly promotionKey: string | null;
  readonly found: FoundFormValues;
}

/** A preset, or custom weeks as typed (so a half-typed number can be shown and checked). */
export type SeasonLengthDraft =
  { readonly preset: SeasonPresetKey } | { readonly customWeeks: string } | null;

export interface NewGameDraftState {
  /** The step on screen, 1-4. The URL's `?step=` is the source; the screen keeps this in step. */
  readonly step: number;
  readonly rootPackId: string | null;
  readonly player: PlayerDraft;
  readonly seasonLength: SeasonLengthDraft;
  /** Setting key to value, for settings changed from their default. */
  readonly settings: Readonly<Record<string, boolean | string>>;
  readonly seed: string;
  /** Null for the world pack's start date. */
  readonly startDate: string | null;
  readonly playerName: string;
  /** Null until the player edits it; the default comes from the promotion and start year. */
  readonly saveName: string | null;
  /** Problems found by the wizard's checks or returned by the engine. */
  readonly issues: readonly WizardIssue[];
  /** True once the player has changed anything, so leaving asks first. */
  readonly dirty: boolean;

  readonly setStep: (step: number) => void;
  /** Picks the world. `byPlayer` is false for the automatic pick when only one world exists. */
  readonly chooseWorld: (rootPackId: string, byPlayer: boolean) => void;
  readonly setPlayerMode: (mode: PlayerMode) => void;
  readonly choosePromotion: (promotionKey: string) => void;
  readonly updateFound: (changes: Partial<FoundFormValues>) => void;
  readonly setSeasonLength: (seasonLength: SeasonLengthDraft) => void;
  readonly setSetting: (key: string, value: boolean | string) => void;
  readonly setSeed: (seed: string) => void;
  readonly setStartDate: (startDate: string | null) => void;
  readonly setPlayerName: (playerName: string) => void;
  readonly setSaveName: (saveName: string) => void;
  readonly setIssues: (issues: readonly WizardIssue[]) => void;
  /** Remembers the settings and player name for the next new game. */
  readonly rememberChoices: () => void;
  /** Back to a fresh draft, keeping what `localStorage` remembers. */
  readonly reset: () => void;
}

/** Where the remembered choices live in `localStorage`. */
export const REMEMBERED_CHOICES_KEY = 'ringside-booker.new-game.remembered';

/** The step number the wizard opens on. */
const FIRST_STEP = 1;

/** Friday: weekly shows default to the end of the working week. */
const DEFAULT_SHOW_DAY: Weekday = 4;

/** The founded promotion's colour until the player picks one: the action red-orange. */
export const DEFAULT_PROMOTION_COLOR = '#d7301a';

/** Bytes of randomness in a generated seed (16 hex characters). */
const SEED_BYTES = 8;

interface RememberedChoices {
  readonly settings: Readonly<Record<string, boolean | string>>;
  readonly playerName: string;
}

const NOTHING_REMEMBERED: RememberedChoices = { settings: {}, playerName: '' };

/** A fresh random seed, from the browser's cryptographic generator (the UI layer, never the engine). */
export function generateSeed(): string {
  const bytes = new Uint8Array(SEED_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isSettingValue(value: unknown): value is boolean | string {
  return typeof value === 'boolean' || typeof value === 'string';
}

/** Reads the remembered choices, ignoring anything missing, malformed or unreadable. */
export function readRememberedChoices(): RememberedChoices {
  try {
    const text = window.localStorage.getItem(REMEMBERED_CHOICES_KEY);
    if (text === null) return NOTHING_REMEMBERED;
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return NOTHING_REMEMBERED;
    const storedSettings: unknown = Reflect.get(parsed, 'settings');
    const storedName: unknown = Reflect.get(parsed, 'playerName');
    const settings: Record<string, boolean | string> = {};
    if (typeof storedSettings === 'object' && storedSettings !== null) {
      for (const [key, value] of Object.entries(storedSettings)) {
        if (isSettingValue(value)) settings[key] = value;
      }
    }
    return { settings, playerName: typeof storedName === 'string' ? storedName : '' };
  } catch {
    return NOTHING_REMEMBERED;
  }
}

function writeRememberedChoices(choices: RememberedChoices): void {
  try {
    window.localStorage.setItem(REMEMBERED_CHOICES_KEY, JSON.stringify(choices));
  } catch {
    // Remembering is a convenience; a browser that refuses storage just starts from defaults.
  }
}

export function emptyFoundForm(): FoundFormValues {
  return {
    name: '',
    shortName: '',
    continentKey: '',
    countryKey: '',
    homeRegionKey: '',
    style: null,
    size: 'medium',
    color: DEFAULT_PROMOTION_COLOR,
    starterKit: true,
    weeklyShowDay: DEFAULT_SHOW_DAY,
  };
}

type DraftValues = Omit<
  NewGameDraftState,
  | 'setStep'
  | 'chooseWorld'
  | 'setPlayerMode'
  | 'choosePromotion'
  | 'updateFound'
  | 'setSeasonLength'
  | 'setSetting'
  | 'setSeed'
  | 'setStartDate'
  | 'setPlayerName'
  | 'setSaveName'
  | 'setIssues'
  | 'rememberChoices'
  | 'reset'
>;

/** A fresh draft: nothing chosen, a new seed, and whatever was remembered from last time. */
export function freshDraft(): DraftValues {
  const remembered = readRememberedChoices();
  return {
    step: FIRST_STEP,
    rootPackId: null,
    player: { mode: 'existing', promotionKey: null, found: emptyFoundForm() },
    seasonLength: null,
    settings: remembered.settings,
    seed: generateSeed(),
    startDate: null,
    playerName: remembered.playerName,
    saveName: null,
    issues: [],
    dirty: false,
  };
}

/** The issues left once the player has changed `fields`: a changed field's old problem is gone. */
function withoutFields(
  issues: readonly WizardIssue[],
  fields: readonly WizardField[],
): readonly WizardIssue[] {
  return issues.filter((issue) => issue.field === null || !fields.includes(issue.field));
}

/** The founding form's keys and the field their problems are shown on. */
const FOUND_FIELD_OF: Readonly<Record<keyof FoundFormValues, WizardField>> = {
  name: 'name',
  shortName: 'shortName',
  continentKey: 'homeRegionKey',
  countryKey: 'homeRegionKey',
  homeRegionKey: 'homeRegionKey',
  style: 'style',
  size: 'size',
  color: 'color',
  starterKit: 'starterKit',
  weeklyShowDay: 'weeklyShowDay',
};

function isFoundFormKey(key: string): key is keyof FoundFormValues {
  return Object.hasOwn(FOUND_FIELD_OF, key);
}

/** The wizard's draft store. Module-level, so the draft survives moving between steps. */
export const useNewGameDraft = create<NewGameDraftState>()((set, get) => ({
  ...freshDraft(),
  setStep: (step) => {
    set({ step });
  },
  chooseWorld: (rootPackId, byPlayer) => {
    if (get().rootPackId === rootPackId) return;
    // Promotions and regions belong to a world, so a different world clears those choices.
    set((state) => ({
      rootPackId,
      player: { ...state.player, promotionKey: null, found: emptyFoundForm() },
      issues: state.issues.filter((issue) => issue.step !== 'world'),
      dirty: state.dirty || byPlayer,
    }));
  },
  setPlayerMode: (mode) => {
    set((state) => ({ player: { ...state.player, mode }, dirty: true }));
  },
  choosePromotion: (promotionKey) => {
    set((state) => ({
      player: { ...state.player, mode: 'existing', promotionKey },
      issues: withoutFields(state.issues, ['promotionKey']),
      dirty: true,
    }));
  },
  updateFound: (changes) => {
    const fields = Object.keys(changes)
      .filter(isFoundFormKey)
      .map((key) => FOUND_FIELD_OF[key]);
    set((state) => ({
      player: { ...state.player, mode: 'found', found: { ...state.player.found, ...changes } },
      issues: withoutFields(state.issues, fields),
      dirty: true,
    }));
  },
  setSeasonLength: (seasonLength) => {
    set((state) => ({
      seasonLength,
      issues: withoutFields(state.issues, ['customWeeks']),
      dirty: true,
    }));
  },
  setSetting: (key, value) => {
    set((state) => ({
      settings: { ...state.settings, [key]: value },
      issues: withoutFields(state.issues, [`setting.${key}`]),
      dirty: true,
    }));
  },
  setSeed: (seed) => {
    set((state) => ({ seed, issues: withoutFields(state.issues, ['seed']), dirty: true }));
  },
  setStartDate: (startDate) => {
    set((state) => ({
      startDate,
      issues: withoutFields(state.issues, ['startDate']),
      dirty: true,
    }));
  },
  setPlayerName: (playerName) => {
    set((state) => ({
      playerName,
      issues: withoutFields(state.issues, ['playerName']),
      dirty: true,
    }));
  },
  setSaveName: (saveName) => {
    set((state) => ({
      saveName,
      issues: withoutFields(state.issues, ['saveName']),
      dirty: true,
    }));
  },
  setIssues: (issues) => {
    set({ issues });
  },
  rememberChoices: () => {
    const { settings, playerName } = get();
    writeRememberedChoices({ settings, playerName: playerName.trim() });
  },
  reset: () => {
    set(freshDraft());
  },
}));
