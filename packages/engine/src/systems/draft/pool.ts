/**
 * The draft pool (DRF-07): how many wrestlers can be drafted, and which ones.
 *
 * - **Size.** `all` takes every wrestler. Otherwise `promotions × roster size × ratio`, the ratio
 *   being `draft.pool.ratio.<auto|small|large>`, and never more than there are wrestlers.
 * - **Card levels.** A wrestler's level is their card position before the draft. A free agent has
 *   none, so they get the level whose contracted wrestlers' median draft value is nearest theirs
 *   (with no contracted wrestlers at all, levels are cut from the value ranking by the shares).
 * - **Mix.** Each level gets `draft.pool.share.<level>` of the pool (largest remainder). Inside a
 *   level the slots are split by gender and weight class in the proportions of the whole world's
 *   wrestlers, and each group is filled best draft value first. A group or level that runs short
 *   hands its slots to the best wrestlers left, first in the same level, then anywhere.
 * - Wrestlers left out **sit out**: no contract, and not free agents (see `rights.ts`).
 *
 * Staff are never cut: with "Draft staff too" every staff member is in the pool.
 *
 * Deterministic: everything is sorted by value, then id.
 *
 * Design: docs/design/draft.md#pool.
 */

import type { PersonId } from '../../core/ids';
import type { Push } from '../../model/entities/employment';
import type { EngineTunables } from '../tunables';
import { compareCandidates, type DraftCandidate } from './candidates';
import type { DraftPoolSize } from './settings';

/** The card levels a pool is mixed by, top down. */
export const CARD_LEVELS = [
  'mainEvent',
  'upperCard',
  'midCard',
  'lowerCard',
  'enhancement',
] as const satisfies readonly Push[];
export type CardLevel = (typeof CARD_LEVELS)[number];

export const CARD_LEVEL_LABELS: Readonly<Record<CardLevel, string>> = {
  mainEvent: 'Main event',
  upperCard: 'Upper midcard',
  midCard: 'Midcard',
  lowerCard: 'Lower card',
  enhancement: 'Enhancement',
};

function isCardLevel(push: Push | null): push is CardLevel {
  return CARD_LEVELS.some((level) => level === push);
}

/** Splits `total` into whole parts by `weights` (largest remainder, ties to the earlier entry). */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + Math.max(0, weight), 0);
  if (sum <= 0 || total <= 0) {
    return weights.map(() => 0);
  }
  const exact = weights.map((weight) => (Math.max(0, weight) / sum) * total);
  const parts = exact.map((value) => Math.floor(value));
  let left = total - parts.reduce((acc, part) => acc + part, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const { index } of order) {
    if (left <= 0) {
      break;
    }
    parts[index] = (parts[index] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

export function levelShares(tunables: EngineTunables): Record<CardLevel, number> {
  return {
    mainEvent: tunables.get('draft.pool.share.mainEvent'),
    upperCard: tunables.get('draft.pool.share.upperCard'),
    midCard: tunables.get('draft.pool.share.midCard'),
    lowerCard: tunables.get('draft.pool.share.lowerCard'),
    enhancement: tunables.get('draft.pool.share.enhancement'),
  };
}

/** The pool size for a setting: `null` means every wrestler. */
export function poolSizeFor(
  setting: DraftPoolSize,
  promotions: number,
  rosterTarget: number,
  tunables: EngineTunables,
): number | null {
  if (setting === 'all') {
    return null;
  }
  const ratio = tunables.get(`draft.pool.ratio.${setting}`);
  // Rounded to a thousandth first, so 10 × 20 × 1.1 is 220, not 221.
  return Math.ceil(Math.round(promotions * rosterTarget * ratio * 1000) / 1000);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Every wrestler's card level: their pre-draft push, or the level whose contracted wrestlers'
 * median value is nearest (ties to the higher level). `wrestlers` must be sorted best first.
 */
export function cardLevels(
  wrestlers: readonly DraftCandidate[],
  tunables: EngineTunables,
): Map<PersonId, CardLevel> {
  const levels = new Map<PersonId, CardLevel>();
  const valuesByLevel = new Map<CardLevel, number[]>();
  for (const wrestler of wrestlers) {
    if (isCardLevel(wrestler.push)) {
      levels.set(wrestler.personId, wrestler.push);
      const list = valuesByLevel.get(wrestler.push) ?? [];
      list.push(wrestler.value);
      valuesByLevel.set(wrestler.push, list);
    }
  }
  const medians = CARD_LEVELS.filter((level) => valuesByLevel.has(level)).map((level) => ({
    level,
    median: median(valuesByLevel.get(level) ?? []),
  }));
  const unplaced = wrestlers.filter((wrestler) => !levels.has(wrestler.personId));
  if (medians.length === 0) {
    // Nobody had a contract: cut the ranking by the shares.
    const shares = levelShares(tunables);
    const counts = apportion(
      unplaced.length,
      CARD_LEVELS.map((level) => shares[level]),
    );
    let index = 0;
    CARD_LEVELS.forEach((level, levelIndex) => {
      for (let count = 0; count < (counts[levelIndex] ?? 0); count += 1) {
        const wrestler = unplaced[index];
        if (wrestler !== undefined) {
          levels.set(wrestler.personId, level);
        }
        index += 1;
      }
    });
    return levels;
  }
  for (const wrestler of unplaced) {
    let best = medians[0];
    for (const entry of medians) {
      if (
        best === undefined ||
        Math.abs(entry.median - wrestler.value) < Math.abs(best.median - wrestler.value)
      ) {
        best = entry;
      }
    }
    levels.set(wrestler.personId, best?.level ?? 'enhancement');
  }
  return levels;
}

export interface PoolMixLevel {
  level: CardLevel;
  label: string;
  /** Slots the shares give this level. */
  slots: number;
  /** Wrestlers of this level in the pool. */
  inPool: number;
  /** Wrestlers of this level in the world (the candidates). */
  available: number;
  female: number;
  male: number;
  other: number;
}

export interface PoolChoice {
  /** The wrestlers in the pool, best first. */
  readonly pool: DraftCandidate[];
  /** The wrestlers who sit out, best first. */
  readonly sitOut: DraftCandidate[];
  readonly mix: PoolMixLevel[];
}

function groupKey(candidate: DraftCandidate): string {
  return `${candidate.gender}|${candidate.weightClass}`;
}

/** Picks the pool from every wrestler candidate (sorted best first). */
export function choosePool(
  wrestlers: readonly DraftCandidate[],
  size: number | null,
  tunables: EngineTunables,
): PoolChoice {
  const levels = cardLevels(wrestlers, tunables);
  const levelOf = (candidate: DraftCandidate): CardLevel =>
    levels.get(candidate.personId) ?? 'enhancement';
  const chosen = new Set<PersonId>();
  const slotsByLevel = new Map<CardLevel, number>();
  if (size === null || size >= wrestlers.length) {
    for (const wrestler of wrestlers) {
      chosen.add(wrestler.personId);
    }
  } else {
    const shares = levelShares(tunables);
    const slots = apportion(
      size,
      CARD_LEVELS.map((level) => shares[level]),
    );
    // The world's mix of gender and weight class, kept inside every level.
    const worldGroups = new Map<string, number>();
    for (const wrestler of wrestlers) {
      worldGroups.set(groupKey(wrestler), (worldGroups.get(groupKey(wrestler)) ?? 0) + 1);
    }
    const groupKeys = [...worldGroups.keys()].sort();
    let spare = 0;
    CARD_LEVELS.forEach((level, levelIndex) => {
      const levelSlots = slots[levelIndex] ?? 0;
      slotsByLevel.set(level, levelSlots);
      const inLevel = wrestlers.filter((wrestler) => levelOf(wrestler) === level);
      const groupSlots = apportion(
        levelSlots,
        groupKeys.map((key) => worldGroups.get(key) ?? 0),
      );
      let taken = 0;
      groupKeys.forEach((key, groupIndex) => {
        let want = groupSlots[groupIndex] ?? 0;
        for (const wrestler of inLevel) {
          if (want <= 0) {
            break;
          }
          if (groupKey(wrestler) === key && !chosen.has(wrestler.personId)) {
            chosen.add(wrestler.personId);
            want -= 1;
            taken += 1;
          }
        }
      });
      // Groups that ran short: the best left in the level.
      for (const wrestler of inLevel) {
        if (taken >= levelSlots) {
          break;
        }
        if (!chosen.has(wrestler.personId)) {
          chosen.add(wrestler.personId);
          taken += 1;
        }
      }
      spare += levelSlots - taken;
    });
    // Levels that ran short: the best left anywhere.
    for (const wrestler of wrestlers) {
      if (spare <= 0) {
        break;
      }
      if (!chosen.has(wrestler.personId)) {
        chosen.add(wrestler.personId);
        spare -= 1;
      }
    }
  }
  const pool = wrestlers
    .filter((wrestler) => chosen.has(wrestler.personId))
    .sort(compareCandidates);
  const sitOut = wrestlers.filter((wrestler) => !chosen.has(wrestler.personId));
  const mix = CARD_LEVELS.map((level) => {
    const inPool = pool.filter((wrestler) => levelOf(wrestler) === level);
    return {
      level,
      label: CARD_LEVEL_LABELS[level],
      slots: slotsByLevel.get(level) ?? inPool.length,
      inPool: inPool.length,
      available: wrestlers.filter((wrestler) => levelOf(wrestler) === level).length,
      female: inPool.filter((wrestler) => wrestler.gender === 'female').length,
      male: inPool.filter((wrestler) => wrestler.gender === 'male').length,
      other: inPool.filter((wrestler) => wrestler.gender === 'nonBinary').length,
    };
  });
  return { pool, sitOut, mix };
}
