/**
 * New-game settings: the options the new-game wizard shows, declared in one registry.
 *
 * The wizard renders straight from this registry, so an option only appears once a system has
 * implemented it and registered it here. The four settings `WorldMeta.settings` names
 * (`agingEnabled`, `sandbox`, `generationLevel`, `levelPlayingField`) are stored in their typed
 * fields; every other registered setting is stored by key in `WorldMeta.settings.extra`. Season
 * length is not a setting here: it has its own presets (see `season.ts`).
 *
 * Systems read a setting with {@link getSetting}, which is typed through {@link NewGameSettingMap}.
 * A system that registers a setting adds its key to that map by declaration merging, the same way
 * systems add their queries to `QueryMap`.
 *
 * See docs/design/new-game.md.
 */

import { RegistryError, InvalidArgumentError } from '../../core/errors';
import type { Reason } from '../../core/api/result';
import type { WorldView } from '../../model/world';
import {
  GENERATION_LEVELS,
  type GenerationLevel,
  type WorldSettings,
} from '../../model/world-meta';

/** A setting's value: on/off, or one option of an enum. */
export type NewGameSettingValue = boolean | string;

/** Where the wizard shows a setting. */
export type NewGameSettingGroup = 'world' | 'difficulty' | 'advanced';

export const NEW_GAME_SETTING_GROUPS: readonly NewGameSettingGroup[] = [
  'world',
  'difficulty',
  'advanced',
];

/** One registered new-game setting. Plain JSON, so the wizard gets the list as it is. */
export interface NewGameSettingDef {
  /** camelCase key, unique across every setting. */
  key: string;
  kind: 'boolean' | 'enum';
  /** The choices of an enum setting, in display order. Only for `enum`. */
  options?: string[];
  /** A boolean for a `boolean` setting, one of `options` for an `enum` setting. */
  default: NewGameSettingValue;
  /** Short label for the wizard. */
  label: string;
  /** One or two sentences saying exactly what the setting does, and nothing more. */
  description: string;
  group: NewGameSettingGroup;
}

/**
 * Every setting's value type, by key. Systems that register a setting add it here:
 *
 * ```ts
 * declare module '../newgame/settings' {
 *   interface NewGameSettingMap {
 *     ownerGoals: boolean;
 *   }
 * }
 * ```
 */
export interface NewGameSettingMap {
  agingEnabled: boolean;
  sandbox: boolean;
  generationLevel: GenerationLevel;
  levelPlayingField: boolean;
  equalStart: boolean;
  randomiseContractLengths: boolean;
  rerollPotential: boolean;
}

/** Any declared setting key. */
export type NewGameSettingKey = Extract<keyof NewGameSettingMap, string>;

/** Every registered setting's chosen value, by key, with defaults filled in. */
export type ResolvedNewGameSettings = Readonly<Record<string, NewGameSettingValue>>;

/** The settings with a typed field of their own on `WorldMeta.settings`. */
export const WORLD_SETTING_KEYS = [
  'agingEnabled',
  'sandbox',
  'generationLevel',
  'levelPlayingField',
] as const satisfies readonly (keyof WorldSettings & NewGameSettingKey)[];

type WorldSettingKey = (typeof WORLD_SETTING_KEYS)[number];

function isWorldSettingKey(key: string): key is WorldSettingKey {
  return WORLD_SETTING_KEYS.some((worldKey) => worldKey === key);
}

/** Setting keys are camelCase words. */
export const SETTING_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

const registry = new Map<string, NewGameSettingDef>();

function copyDef(def: NewGameSettingDef): NewGameSettingDef {
  return {
    key: def.key,
    kind: def.kind,
    ...(def.options === undefined ? {} : { options: [...def.options] }),
    default: def.default,
    label: def.label,
    description: def.description,
    group: def.group,
  };
}

function checkDef(def: NewGameSettingDef): void {
  const fail = (message: string): never => {
    throw new RegistryError(`New-game setting "${def.key}": ${message}`, { setting: def.key });
  };
  if (!SETTING_KEY_PATTERN.test(def.key)) {
    fail('the key must be a camelCase word such as "ownerGoals"');
  }
  if (registry.has(def.key)) {
    fail('a setting with this key is already registered');
  }
  if (def.label.trim() === '' || def.description.trim() === '') {
    fail('needs a label and a description');
  }
  if (!NEW_GAME_SETTING_GROUPS.includes(def.group)) {
    fail(`unknown group "${def.group}"`);
  }
  if (def.kind === 'boolean') {
    if (def.options !== undefined) {
      fail('a boolean setting has no options');
    }
    if (typeof def.default !== 'boolean') {
      fail('a boolean setting needs a true or false default');
    }
    return;
  }
  const options = def.options ?? [];
  if (options.length < 2) {
    fail('an enum setting needs at least two options');
  }
  if (new Set(options).size !== options.length) {
    fail('enum options must be unique');
  }
  if (typeof def.default !== 'string' || !options.includes(def.default)) {
    fail('the default must be one of the options');
  }
}

/**
 * Adds a setting to the wizard. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a malformed definition or a key that is already taken.
 */
export function registerNewGameSetting(def: NewGameSettingDef): () => void {
  checkDef(def);
  const stored = copyDef(def);
  registry.set(def.key, stored);
  return () => {
    if (registry.get(def.key) === stored) {
      registry.delete(def.key);
    }
  };
}

/** Every registered setting, in registration order, as fresh plain objects. */
export function newGameSettings(): NewGameSettingDef[] {
  return [...registry.values()].map(copyDef);
}

/** The registered setting with this key, or undefined. */
export function newGameSettingDef(key: string): NewGameSettingDef | undefined {
  const def = registry.get(key);
  return def === undefined ? undefined : copyDef(def);
}

function isValueOf(def: NewGameSettingDef, value: unknown): value is NewGameSettingValue {
  if (def.kind === 'boolean') {
    return typeof value === 'boolean';
  }
  return typeof value === 'string' && (def.options ?? []).includes(value);
}

function expectedOf(def: NewGameSettingDef): string {
  return def.kind === 'boolean'
    ? 'true or false'
    : `one of ${(def.options ?? []).map((option) => `"${option}"`).join(', ')}`;
}

/**
 * Checks the settings a player chose: every key must be registered and every value must suit its
 * setting. One reason per problem, with the field `settings.<key>`.
 */
export function settingReasons(chosen: Readonly<Record<string, unknown>>): Reason[] {
  const reasons: Reason[] = [];
  for (const key of Object.keys(chosen).sort()) {
    const field = `settings.${key}`;
    const def = registry.get(key);
    if (def === undefined) {
      reasons.push({
        code: 'unknownSetting',
        message: `There is no new-game setting called "${key}".`,
        field,
      });
      continue;
    }
    const value = chosen[key];
    if (!isValueOf(def, value)) {
      reasons.push({
        code: 'invalidSetting',
        message: `${def.label} must be ${expectedOf(def)}.`,
        field,
      });
    }
  }
  return reasons;
}

/**
 * Every registered setting's value: the chosen one, or the default. Keys in registration order.
 * Call {@link settingReasons} first; a value that does not fit is replaced by the default.
 */
export function resolveNewGameSettings(
  chosen: Readonly<Record<string, unknown>>,
): ResolvedNewGameSettings {
  const resolved: Record<string, NewGameSettingValue> = {};
  for (const def of registry.values()) {
    const value = chosen[def.key];
    resolved[def.key] = isValueOf(def, value) ? value : def.default;
  }
  return Object.freeze(resolved);
}

function booleanOf(settings: ResolvedNewGameSettings, key: WorldSettingKey): boolean {
  const value = settings[key];
  if (typeof value !== 'boolean') {
    throw new InvalidArgumentError('worldSettingsFrom', key, value, 'true or false');
  }
  return value;
}

function generationLevelOf(settings: ResolvedNewGameSettings): GenerationLevel {
  const value = settings['generationLevel'];
  const level = GENERATION_LEVELS.find((candidate) => candidate === value);
  if (level === undefined) {
    throw new InvalidArgumentError(
      'worldSettingsFrom',
      'generationLevel',
      value,
      `one of ${GENERATION_LEVELS.join(', ')}`,
    );
  }
  return level;
}

/**
 * The `WorldMeta.settings` a world stores for these settings and season length: the four typed
 * settings in their own fields, every other registered setting in `extra` (sorted by key).
 */
export function worldSettingsFrom(
  settings: ResolvedNewGameSettings,
  seasonLengthDays: number,
): WorldSettings {
  const extra: Record<string, NewGameSettingValue> = {};
  for (const key of Object.keys(settings).sort()) {
    const value = settings[key];
    if (!isWorldSettingKey(key) && value !== undefined) {
      extra[key] = value;
    }
  }
  return {
    agingEnabled: booleanOf(settings, 'agingEnabled'),
    sandbox: booleanOf(settings, 'sandbox'),
    generationLevel: generationLevelOf(settings),
    levelPlayingField: booleanOf(settings, 'levelPlayingField'),
    season: { lengthDays: seasonLengthDays },
    extra,
  };
}

/** True when `value` is what setting `key` holds. Checked against the registered definition. */
function isSettingValue<K extends NewGameSettingKey>(
  def: NewGameSettingDef,
  _key: K,
  value: unknown,
): value is NewGameSettingMap[K] {
  return isValueOf(def, value);
}

/**
 * The value of a setting in a world: the typed field for the four world settings, the `extra`
 * entry for the rest, or the registered default when a world from before the setting existed has
 * none. Systems read settings through this, never by raw string.
 *
 * @throws InvalidArgumentError for a key no system registered, or a stored value that does not
 *   suit the setting.
 */
export function getSetting<K extends NewGameSettingKey>(
  world: Pick<WorldView, 'meta'>,
  key: K,
): NewGameSettingMap[K] {
  const def = registry.get(key);
  if (def === undefined) {
    throw new InvalidArgumentError('getSetting', 'key', key, 'a registered new-game setting');
  }
  const { settings } = world.meta;
  const stored: unknown = isWorldSettingKey(key) ? settings[key] : settings.extra[key];
  const value = stored === undefined ? def.default : stored;
  if (!isSettingValue(def, key, value)) {
    throw new InvalidArgumentError('getSetting', key, value, expectedOf(def));
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Built-in settings

/** The settings this package registers itself. */
export const BUILT_IN_SETTINGS: readonly NewGameSettingDef[] = [
  {
    key: 'agingEnabled',
    kind: 'boolean',
    default: true,
    label: 'Aging',
    description: 'People get older, and their skills follow their age.',
    group: 'world',
  },
  {
    key: 'sandbox',
    kind: 'boolean',
    default: false,
    label: 'Sandbox',
    description: 'You may edit the world freely while you play.',
    group: 'world',
  },
  {
    key: 'generationLevel',
    kind: 'enum',
    options: [...GENERATION_LEVELS],
    default: 'low',
    label: 'New talent and companies',
    description:
      'How much new content the world creates over time, such as debuting wrestlers and new promotions.',
    group: 'world',
  },
  {
    key: 'levelPlayingField',
    kind: 'boolean',
    default: false,
    label: 'Level playing field',
    description:
      'Rival promotions follow exactly the same rules as yours: no simulation shortcuts.',
    group: 'difficulty',
  },
  {
    key: 'equalStart',
    kind: 'boolean',
    default: false,
    label: 'Equal start',
    description:
      'A one-time reset when the game starts: every promotion gets the same cash, prestige and home-country popularity, and every TV deal is cancelled.',
    group: 'difficulty',
  },
  {
    key: 'randomiseContractLengths',
    kind: 'boolean',
    default: false,
    label: 'Shuffle contract lengths',
    description: 'Every running contract with an end date gets a new, random end date.',
    group: 'advanced',
  },
  {
    key: 'rerollPotential',
    kind: 'boolean',
    default: false,
    label: 'Re-roll potential',
    description:
      'Everyone gets a fresh roll for how much they can still improve, so the future stars are a surprise.',
    group: 'advanced',
  },
];

for (const def of BUILT_IN_SETTINGS) {
  registerNewGameSetting(def);
}
