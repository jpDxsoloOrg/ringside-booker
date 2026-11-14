/**
 * Skip alerts: the stories a player wants to hear about straight away.
 *
 * A player picks alert rules (front-page stories, my promotion, my roster, my champions, title
 * changes anywhere). When a new story matches one of their enabled rules, it becomes their pending
 * alert, and the `news.alert` gate stops a skip before the next day with "News: …" until the player
 * clears it (`news.ackAlerts`, which the News screen runs when the story is opened).
 *
 * The rules are a registry, so later features add their own (WRK3's "Shortlisted workers") with
 * `registerNewsAlertRule`, without editing this file.
 *
 * Per-player state lives in `WorldMeta.settings.extra` under `news.alerts.<playerId>.`: it is
 * runtime state, not a new-game option, so `getSetting` is not used for it. Keeping every key under
 * that prefix makes a later move to a dedicated table one migration.
 *
 * News is public (D-07): rules decide whom to alert, never who may read a story.
 *
 * Design: docs/design/news.md#alerts.
 */

import { viewerPromotionIds } from '../../core/api/controller';
import { defineSubscription } from '../../core/api/system';
import type { GameDate } from '../../core/date';
import { RegistryError } from '../../core/errors';
import { isId, type NewsId, type PromotionId } from '../../core/ids';
import type { GateHit, GateSpec } from '../../core/pipeline/gates';
import { NEWS_KIND_LABELS, type News } from '../../model/entities/news';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { WorldMeta, WorldSettings } from '../../model/world-meta';
import type { EngineTunables } from '../tunables';
import { isFrontPage } from './frontPage';
import { displayNameOf } from './subjects';

type Story = DeepReadonly<News>;

/** What a rule's `matches` may read besides the story. */
export interface NewsAlertRuleContext {
  readonly read: GameWorldView;
  /** The promotions the player runs (`viewerPromotionIds`), lowest id first. */
  readonly promotionIds: readonly PromotionId[];
  readonly date: GameDate;
  readonly tunables: EngineTunables;
}

/** One alert rule a player can switch on or off. */
export interface NewsAlertRule {
  /** camelCase, unique. Stored in the player's settings key. */
  readonly id: string;
  /** Plain words for the settings list: "My champions". */
  readonly label: string;
  /** One sentence saying which stories it catches. */
  readonly description: string;
  /** Position in the settings list, lowest first. */
  readonly order: number;
  /** Whether the rule is on for a player who never set it. */
  readonly defaultOn: boolean;
  /** True when the story should alert a player running `ctx.promotionIds`. Read only. */
  readonly matches: (news: Story, ctx: NewsAlertRuleContext) => boolean;
}

/** A rule id: one camelCase word. */
export const NEWS_ALERT_RULE_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/** The gate's id and its action hint (the web shell's route key for the News screen). */
export const NEWS_ALERT_GATE_ID = 'news.alert';
export const NEWS_ACTION_HINT = 'news';

/** The subscription that turns a new story into a pending alert. */
export const MATCH_ALERTS_SUBSCRIPTION_ID = 'news.matchAlerts';

/**
 * Whether a pending alert stops a skip for a player who never set `stopSkip`. Off until the News
 * screen can open and clear an alert (DAY1-05 turns it on): a stop the player has no screen to
 * clear would block Next Day. A player can still turn it on with `news.setAlertRules`.
 */
export const NEWS_ALERT_STOP_SKIP_DEFAULT = false;

/** The prefix of every news alert key in `settings.extra`. */
export const NEWS_ALERTS_SETTINGS_PREFIX = 'news.alerts.';

/** Checks a rule and returns it frozen. Throws `RegistryError` for a malformed one. */
export function defineNewsAlertRule(rule: NewsAlertRule): NewsAlertRule {
  if (!NEWS_ALERT_RULE_ID_PATTERN.test(rule.id)) {
    throw new RegistryError(`News alert rule id ${JSON.stringify(rule.id)} must be camelCase`, {
      rule: rule.id,
    });
  }
  if (rule.label.trim() === '' || rule.description.trim() === '') {
    throw new RegistryError(`News alert rule ${rule.id} needs a label and a description`, {
      rule: rule.id,
    });
  }
  if (!Number.isFinite(rule.order)) {
    throw new RegistryError(`News alert rule ${rule.id} needs a finite order`, { rule: rule.id });
  }
  return Object.freeze({ ...rule });
}

const registry = new Map<string, NewsAlertRule>();

/**
 * Adds a rule to every player's list. Returns a function that removes it again (for tests).
 * Throws `RegistryError` when the id is taken.
 */
export function registerNewsAlertRule(rule: NewsAlertRule): () => void {
  const defined = defineNewsAlertRule(rule);
  if (registry.has(defined.id)) {
    throw new RegistryError(`A news alert rule with id ${defined.id} is already registered`, {
      rule: defined.id,
    });
  }
  registry.set(defined.id, defined);
  return () => {
    if (registry.get(defined.id) === defined) {
      registry.delete(defined.id);
    }
  };
}

/** Every registered rule, by `order`, then id. */
export function newsAlertRules(): NewsAlertRule[] {
  return [...registry.values()].sort(
    (left, right) => left.order - right.order || (left.id < right.id ? -1 : 1),
  );
}

/** The registered rule with this id. */
export function newsAlertRule(id: string): NewsAlertRule | undefined {
  return registry.get(id);
}

// --------------------------------------------------------------------------------------------
// Built-in rules

function touchesPromotion(news: Story, promotionIds: readonly PromotionId[]): boolean {
  return news.refs.promotionIds.some((id) => promotionIds.includes(id));
}

function employsAny(news: Story, ctx: NewsAlertRuleContext): boolean {
  return news.refs.personIds.some((personId) =>
    ctx.read.tables.employments
      .lookup('byPerson', personId)
      .some(
        (employment) =>
          employment.status === 'active' && ctx.promotionIds.includes(employment.promotionId),
      ),
  );
}

function holdsOurTitle(news: Story, ctx: NewsAlertRuleContext): boolean {
  return news.refs.personIds.some((personId) =>
    ctx.read.tables.titleReigns.lookup('byHolder', personId).some((reign) => {
      if (reign.lostOn !== null) {
        return false;
      }
      const title = ctx.read.tables.titles.get(reign.titleId);
      return title !== undefined && ctx.promotionIds.includes(title.promotionId);
    }),
  );
}

export const BUILT_IN_NEWS_ALERT_RULES: readonly NewsAlertRule[] = [
  defineNewsAlertRule({
    id: 'frontPage',
    label: 'Front-page stories',
    description: 'The biggest stories in the wrestling world.',
    order: 10,
    defaultOn: true,
    matches: (news, ctx) => isFrontPage(news, ctx.tunables),
  }),
  defineNewsAlertRule({
    id: 'myPromotion',
    label: 'Stories about my promotion',
    description: 'Any story that names my promotion.',
    order: 20,
    defaultOn: false,
    matches: (news, ctx) => touchesPromotion(news, ctx.promotionIds),
  }),
  defineNewsAlertRule({
    id: 'myRoster',
    label: 'My roster',
    description: 'Any story about someone under contract with me.',
    order: 30,
    defaultOn: false,
    matches: employsAny,
  }),
  defineNewsAlertRule({
    id: 'myChampions',
    label: 'My champions',
    description: 'Any story about someone holding one of my titles.',
    order: 40,
    defaultOn: false,
    matches: holdsOurTitle,
  }),
  defineNewsAlertRule({
    id: 'titleChanges',
    label: 'Title changes anywhere',
    description: 'Every title change, in any promotion.',
    order: 50,
    defaultOn: false,
    matches: (news) => news.kind === 'titleChange',
  }),
];

for (const rule of BUILT_IN_NEWS_ALERT_RULES) {
  registerNewsAlertRule(rule);
}

// --------------------------------------------------------------------------------------------
// Per-player settings

/** One player's alert settings. */
export interface AlertSettings {
  /** Every registered rule's state: the stored value, else its `defaultOn`. */
  readonly rules: Readonly<Record<string, boolean>>;
  /** Whether a pending alert stops a skip. */
  readonly stopSkip: boolean;
  /** The story waiting for the player, or null. */
  readonly pending: NewsId | null;
}

/** A change to one player's alert settings. `pending: null` clears it. */
export interface AlertSettingsPatch {
  readonly rules?: Readonly<Record<string, boolean>>;
  readonly stopSkip?: boolean;
  readonly pending?: NewsId | null;
}

/** `news.alerts.<playerId>.rule.<ruleId>` */
export function alertRuleKey(playerId: string, ruleId: string): string {
  return `${NEWS_ALERTS_SETTINGS_PREFIX}${playerId}.rule.${ruleId}`;
}

/** `news.alerts.<playerId>.pending` */
export function alertPendingKey(playerId: string): string {
  return `${NEWS_ALERTS_SETTINGS_PREFIX}${playerId}.pending`;
}

/** `news.alerts.<playerId>.stopSkip` */
export function alertStopSkipKey(playerId: string): string {
  return `${NEWS_ALERTS_SETTINGS_PREFIX}${playerId}.stopSkip`;
}

type MetaWithSettings = Pick<DeepReadonly<WorldMeta>, 'settings'>;

/** The player's pending story id, or null. One lookup. */
export function pendingAlertOf(meta: MetaWithSettings, playerId: string): NewsId | null {
  const value = meta.settings.extra[alertPendingKey(playerId)];
  return isId('news', value) ? value : null;
}

/** Whether the player's pending alert stops a skip. One lookup. */
export function stopSkipOf(meta: MetaWithSettings, playerId: string): boolean {
  const value = meta.settings.extra[alertStopSkipKey(playerId)];
  return typeof value === 'boolean' ? value : NEWS_ALERT_STOP_SKIP_DEFAULT;
}

/** Whether rule `rule` is on for the player: the stored value, else the rule's default. */
export function ruleEnabledFor(
  meta: MetaWithSettings,
  playerId: string,
  rule: NewsAlertRule,
): boolean {
  const value = meta.settings.extra[alertRuleKey(playerId, rule.id)];
  return typeof value === 'boolean' ? value : rule.defaultOn;
}

/** The player's alert settings, with every registered rule. */
export function alertSettingsOf(meta: MetaWithSettings, playerId: string): AlertSettings {
  const rules: Record<string, boolean> = {};
  for (const rule of newsAlertRules()) {
    rules[rule.id] = ruleEnabledFor(meta, playerId, rule);
  }
  return {
    rules,
    stopSkip: stopSkipOf(meta, playerId),
    pending: pendingAlertOf(meta, playerId),
  };
}

/**
 * A new `settings` object with `patch` applied to the player's keys, for
 * `tx.setMeta({ settings })`. Only the keys in the patch change; `extra` keys stay sorted, as
 * `worldSettingsFrom` sorts them.
 */
export function withAlertSettings(
  meta: MetaWithSettings,
  playerId: string,
  patch: AlertSettingsPatch,
): WorldSettings {
  const extra: Record<string, boolean | number | string> = { ...meta.settings.extra };
  for (const [ruleId, enabled] of Object.entries(patch.rules ?? {})) {
    extra[alertRuleKey(playerId, ruleId)] = enabled;
  }
  if (patch.stopSkip !== undefined) {
    extra[alertStopSkipKey(playerId)] = patch.stopSkip;
  }
  if (patch.pending !== undefined) {
    const key = alertPendingKey(playerId);
    if (patch.pending === null) {
      delete extra[key];
    } else {
      extra[key] = patch.pending;
    }
  }
  const sorted: Record<string, boolean | number | string> = {};
  for (const key of Object.keys(extra).sort()) {
    const value = extra[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  return {
    agingEnabled: meta.settings.agingEnabled,
    sandbox: meta.settings.sandbox,
    generationLevel: meta.settings.generationLevel,
    levelPlayingField: meta.settings.levelPlayingField,
    season: { lengthDays: meta.settings.season.lengthDays },
    extra: sorted,
  };
}

/** The promotions a human player runs, lowest id first: `viewerPromotionIds` for that player. */
export function promotionsOfPlayer(read: GameWorldView, playerId: string): PromotionId[] {
  return viewerPromotionIds(read, { kind: 'controller', controller: { kind: 'human', playerId } });
}

// --------------------------------------------------------------------------------------------
// The reason, the reaction and the gate

/** Most subject names the reason lists before "and N more". */
const REASON_NAMES = 2;

/**
 * "News: Title change – Big Joe and Fast Eddie", "News: Signing – Big Joe, Hardpan Wrestling and
 * 2 more", or "News: a front-page season story" for a story naming no one. Player text: no ids or
 * keys. People who still exist come first, then promotions.
 */
export function newsAlertReason(read: GameWorldView, news: Story): string {
  const date = read.meta.currentDate;
  const names: string[] = [];
  for (const personId of news.refs.personIds) {
    if (read.tables.people.has(personId)) {
      names.push(displayNameOf(read, personId, date));
    }
  }
  for (const promotionId of news.refs.promotionIds) {
    const promotion = read.tables.promotions.get(promotionId);
    if (promotion !== undefined) {
      names.push(promotion.name);
    }
  }
  const label = NEWS_KIND_LABELS[news.kind];
  if (names.length === 0) {
    return `News: a front-page ${label.toLowerCase()} story`;
  }
  const shown = names.slice(0, REASON_NAMES);
  const more = names.length - shown.length;
  const list =
    more > 0
      ? `${shown.join(', ')} and ${String(more)} more`
      : shown.length === 2
        ? `${shown[0] ?? ''} and ${shown[1] ?? ''}`
        : (shown[0] ?? '');
  return `News: ${label} – ${list}`;
}

/** The first enabled rule (by order) the story matches for the player, or null. */
export function firstMatchingRule(
  meta: MetaWithSettings,
  playerId: string,
  news: Story,
  ctx: NewsAlertRuleContext,
): NewsAlertRule | null {
  for (const rule of newsAlertRules()) {
    if (ruleEnabledFor(meta, playerId, rule) && rule.matches(news, ctx)) {
      return rule;
    }
  }
  return null;
}

/**
 * `news.matchAlerts`: when a story is posted, every player (in `meta.players` order) with no
 * pending alert, or one whose story is gone, gets this story as their pending alert if any of
 * their enabled rules matches it. Only the first story waits: the player sees the later ones on
 * the News screen. Publishes `news.alertRaised`.
 */
export const matchAlertsSubscription = defineSubscription({
  id: MATCH_ALERTS_SUBSCRIPTION_ID,
  type: 'news.posted',
  handler: (event, ctx) => {
    const news = ctx.read.tables.news.get(event.payload.newsId);
    if (news === undefined) {
      return;
    }
    for (const player of ctx.read.meta.players) {
      const { playerId } = player;
      const pending = pendingAlertOf(ctx.read.meta, playerId);
      if (pending !== null && ctx.read.tables.news.has(pending)) {
        continue;
      }
      const rule = firstMatchingRule(ctx.read.meta, playerId, news, {
        read: ctx.read,
        promotionIds: promotionsOfPlayer(ctx.read, playerId),
        date: ctx.date,
        tunables: ctx.tunables,
      });
      if (rule === null) {
        continue;
      }
      ctx.tx.setMeta({ settings: withAlertSettings(ctx.read.meta, playerId, { pending: news.id }) });
      ctx.publish('news.alertRaised', { playerId, newsId: news.id, ruleId: rule.id });
    }
  },
});

/**
 * `news.alert`: stops a skip before the next day while a player has a pending alert whose story
 * still exists and their `stopSkip` is on. One lookup per player.
 *
 * TODO(MP): a gate has no viewer, so this reports the first player in `meta.players` with a
 * pending alert. Right for one local player; multiplayer can narrow it to the advancing seat.
 */
export const newsAlertGate: GateSpec = {
  id: NEWS_ALERT_GATE_ID,
  label: 'News alert',
  check: (view, _date): GateHit | null => {
    for (const player of view.meta.players) {
      if (!stopSkipOf(view.meta, player.playerId)) {
        continue;
      }
      const pending = pendingAlertOf(view.meta, player.playerId);
      const news = pending === null ? undefined : view.tables.news.get(pending);
      if (news === undefined) {
        continue;
      }
      return {
        gateId: NEWS_ALERT_GATE_ID,
        reason: newsAlertReason(view, news),
        subject: { kind: 'news', id: news.id },
        actionHint: NEWS_ACTION_HINT,
      };
    }
    return null;
  },
};
