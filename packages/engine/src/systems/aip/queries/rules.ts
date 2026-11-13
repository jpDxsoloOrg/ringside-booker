/**
 * `aip.rules`: the Rival rules shortcuts as they stand, for the "Rival rules" chip and panel.
 *
 * The rules are the same for every viewer: the tunables and the level playing field setting are
 * not secret. A shortcut is "in force" when its tunable is on (above 0 for the score bonus) and the
 * level playing field is off; it then applies to every computer-run promotion and brand
 * (`appliesTo`). `consumers` lists the features that act on it so far, so the screen can say
 * "Takes effect when <feature> is in the game" for one nothing reads yet. See
 * docs/design/rival-desk.md#shortcuts.
 */

import { z } from 'zod';
import type { NoArgs } from '../../../core/api/builtins';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import { aiShortcutConsumers } from '../aiShortcut';
import { AI_SHORTCUT_KEYS, AI_SHORTCUTS, isAiShortcutFlag, type AiShortcutKey } from '../shortcuts';

/** One shortcut on the rules panel. */
export interface AiShortcutRuleView {
  key: AiShortcutKey;
  /** For example "No in-match injuries". */
  label: string;
  /** The tunable's description: what the shortcut does. */
  description: string;
  /** What happens when it is off. */
  offText: string;
  /** The feature expected to act on it, for "Takes effect when <feature> is in the game". */
  consumer: string;
  /** `flag` for an on/off shortcut, `points` for the score bonus. */
  kind: 'flag' | 'points';
  /** The tunable's value in this game. */
  value: boolean | number;
  defaultValue: boolean | number;
  /** True when the save overrides the tunable (even to its default). */
  overridden: boolean;
  /** On (or above 0) and the level playing field is off. */
  inForce: boolean;
  /** Labels of the features that act on it so far, in registration order. */
  consumers: string[];
}

/** `aip.rules`: every shortcut and the setting that turns them all off. */
export interface AipRulesView {
  levelPlayingField: boolean;
  /** Shortcuts only ever apply to promotions and brands the computer runs. */
  appliesTo: 'computer';
  /** In `AI_SHORTCUT_KEYS` order. */
  shortcuts: AiShortcutRuleView[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'aip.rules': { args: NoArgs; result: AipRulesView };
  }
}

const noArgs: z.ZodType<NoArgs> = z.strictObject({});

export const aipRulesQuery: QueryDefinition<'aip.rules'> = defineQuery('aip.rules', {
  args: noArgs,
  run: (ctx) => {
    const levelPlayingField = ctx.read.meta.settings.levelPlayingField;
    const shortcuts = AI_SHORTCUT_KEYS.map((key): AiShortcutRuleView => {
      const value = ctx.tunables.get(key);
      const enabled = typeof value === 'boolean' ? value : value > 0;
      return {
        key,
        label: AI_SHORTCUTS[key].label,
        description: ctx.tunables.def(key).description,
        offText: AI_SHORTCUTS[key].offText,
        consumer: AI_SHORTCUTS[key].consumer,
        kind: isAiShortcutFlag(key) ? 'flag' : 'points',
        value,
        defaultValue: ctx.tunables.defaultOf(key),
        overridden: ctx.tunables.isOverridden(key),
        inForce: enabled && !levelPlayingField,
        consumers: aiShortcutConsumers(key).map((consumer) => consumer.label),
      };
    });
    return { levelPlayingField, appliesTo: 'computer', shortcuts };
  },
});
