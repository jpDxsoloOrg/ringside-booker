/**
 * The Aftermath panel's wording and number formats (MTCH3-04), kept apart from the components so
 * they can be tested on their own. Popularity shows one decimal, momentum whole numbers. Nothing
 * here mentions morale: a match result never changes it (D-09).
 */
import type { AftermathRegionRow, MatchResultForSide, TraceNode } from '@ringside/engine';
import {
  formatNumber,
  formatPopularity,
  formatPopularityChange,
  formatSigned,
} from '@/components/format';
import type { Tone } from '@/components/tone';

/** The empty state before the first Run. */
export const AFTERMATH_EMPTY_BODY =
  'Run the match to see what this result would do to popularity and momentum.';

/** The note when the line-up or setup changed after the Run on screen. */
export const AFTERMATH_STALE_TEXT = 'Setup changed: run again to update these numbers.';

/** Above this many competitors, each worker's regions open one at a time. */
export const AFTERMATH_COMPACT_FROM = 9;

export const OUTCOME_LABELS: Readonly<Record<MatchResultForSide, string>> = {
  win: 'Win',
  loss: 'Loss',
  draw: 'Draw',
  noContest: 'No contest',
};

export const OUTCOME_TONES: Readonly<Record<MatchResultForSide, Tone>> = {
  win: 'positive',
  loss: 'negative',
  draw: 'neutral',
  noContest: 'neutral',
};

/** Where the popularity figures are rolled up to. */
export type AftermathLevel = 'region' | 'country' | 'continent';

export const AFTERMATH_LEVEL_LABELS: Readonly<Record<AftermathLevel, string>> = {
  region: 'Region',
  country: 'Country',
  continent: 'Continent',
};

export const AFTERMATH_LEVELS: readonly AftermathLevel[] = ['region', 'country', 'continent'];

/** `44.6`: one decimal at most, the shared popularity rule. */
export function popularityText(value: number): string {
  return formatPopularity(value);
}

/** `+2.6`, `−0.4`, or `0` for a change that rounds to nothing. */
export function popularityChangeText(change: number): string {
  return formatPopularityChange(change);
}

/** `22`: whole numbers. */
export function momentumText(value: number): string {
  return formatNumber(value);
}

/** `+10`, `−5`, or `0`. */
export function momentumChangeText(change: number): string {
  return formatSigned(change);
}

/** "No contract with Altura: momentum isn't tracked". */
export function noContractText(promotionName: string): string {
  return `No contract with ${promotionName}: momentum isn't tracked`;
}

/** The Source column: "Show region", "Neighbour" or the reach reason ("TV reach: Coastline"). */
export function regionSourceText(row: Pick<AftermathRegionRow, 'source' | 'reason'>): string {
  if (row.source === 'show') return 'Show region';
  if (row.source === 'neighbour') return 'Neighbour';
  return row.reason;
}

/** The Why? label for a region's figure: "Popularity in Northeast". */
export function regionWhyLabel(name: string): string {
  return `Popularity in ${name}`;
}

/** True for a region that `share` step of the door's trace is about. */
function isShareStep(node: TraceNode, row: AftermathRegionRow): boolean {
  return node.kind === 'multiply' && node.label === `Share for ${row.name}`;
}

/**
 * The region's Why? with the spread line spelled out: the door's "Share for X" step gets the
 * region's reason ("Neighbour of Northeast", "TV reach: ..."). When the door's trace has no such
 * step (a weight of 1 is still a step, so this is only a safety net) the reason is put in front.
 */
export function regionWhyTrace(row: AftermathRegionRow): TraceNode {
  const { trace } = row;
  const children = trace.children ?? [];
  if (children.some((child) => isShareStep(child, row))) {
    return {
      ...trace,
      children: children.map((child) =>
        isShareStep(child, row) && child.kind === 'multiply'
          ? { ...child, reason: row.reason }
          : child,
      ),
    };
  }
  return {
    kind: 'input',
    label: regionWhyLabel(row.name),
    value: row.after,
    unit: 'points',
    children: [{ kind: 'input', label: row.reason, value: row.weight, unit: 'ratio' }, trace],
  };
}
