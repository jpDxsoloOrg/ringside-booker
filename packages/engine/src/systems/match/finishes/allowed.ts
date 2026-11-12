/**
 * Which finishes a match may end with (MTCH2).
 *
 * `allowedFinishes` walks the finish catalog in catalog order (`order`, then key) and keeps an
 * entry when its `matchTypes` rule admits the match type, dropping `requiresTwoSides` entries when
 * the match has more than two sides. It then runs the registered finish filters in `order` (ties by
 * id). The side count is the number of sides actually built (in the lab or on the card); left out,
 * it falls back to the match type's minimum side count.
 *
 * The filter seam is for MTCH7 (stipulations): a filter gets the entries left so far and the
 * context, and may only take entries away. A filter that hands back an entry it was not given
 * throws `RegistryError` naming the filter.
 *
 * Design: docs/design/match-finishes.md#allowed-finishes.
 */

import type { ContentKey } from '../../../core/content-key';
import { RegistryError } from '../../../core/errors';
import type { Catalogs, FinishEntry as FinishEntryDef } from '../../../model/catalogs';
import type { DeepReadonly } from '../../../model/world';
import { finishAdmitsMatchType } from '../catalog/finishes';

/** A finish as the catalogs hold it, read-only. */
export type FinishEntry = DeepReadonly<FinishEntryDef>;

/** What `allowedFinishes` is asked about. */
export interface AllowedFinishesArgs {
  readonly matchTypeKey: ContentKey;
  /** Sides actually built; left out, the match type's minimum (2 for an unknown type). */
  readonly sideCount?: number | undefined;
  /** Stipulations on the match (MTCH7 reads them in its filter). Left out = none. */
  readonly stipulationKeys?: readonly ContentKey[] | undefined;
}

/** The context every filter sees, with the defaults filled in. */
export interface FinishFilterContext {
  readonly matchTypeKey: ContentKey;
  readonly sideCount: number;
  readonly stipulationKeys: readonly ContentKey[];
}

/** One registered finish filter. */
export interface FinishFilter {
  /** Unique across every registered filter. */
  readonly id: string;
  /** Filters run lowest `order` first, ties by id. */
  readonly order: number;
  /** Returns the entries to keep: a subset of `entries`, never a new one. */
  readonly filter: (
    entries: readonly FinishEntry[],
    ctx: FinishFilterContext,
  ) => readonly FinishEntry[];
}

/** A match needs exactly this many sides for a `requiresTwoSides` finish. */
const TWO_SIDES = 2;

const filters = new Map<string, FinishFilter>();

/**
 * Adds a finish filter. Returns a function that removes it again.
 *
 * @throws RegistryError when a filter with this id is already registered.
 */
export function registerFinishFilter(filter: FinishFilter): () => void {
  if (filters.has(filter.id)) {
    throw new RegistryError(`Finish filter "${filter.id}" is already registered`, {
      filter: filter.id,
    });
  }
  const stored: FinishFilter = { id: filter.id, order: filter.order, filter: filter.filter };
  filters.set(filter.id, stored);
  return () => {
    if (filters.get(filter.id) === stored) {
      filters.delete(filter.id);
    }
  };
}

function compareFilters(left: FinishFilter, right: FinishFilter): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

function compareFinishes(left: FinishEntry, right: FinishEntry): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  if (left.key === right.key) {
    return 0;
  }
  return left.key < right.key ? -1 : 1;
}

function runFilter(
  filter: FinishFilter,
  entries: readonly FinishEntry[],
  ctx: FinishFilterContext,
): readonly FinishEntry[] {
  const given = new Set(entries.map((entry) => entry.key));
  const kept = filter.filter(entries, ctx);
  const added = kept.find((entry) => !given.has(entry.key));
  if (added !== undefined) {
    throw new RegistryError(
      `Finish filter "${filter.id}" returned ${added.key}, which it was not given; a filter may only remove finishes`,
      { filter: filter.id, finishKey: added.key },
    );
  }
  return kept;
}

/** The side count `allowedFinishes` uses: the one given, else the match type's minimum. */
export function finishSideCount(
  catalogs: DeepReadonly<Catalogs>,
  args: AllowedFinishesArgs,
): number {
  if (args.sideCount !== undefined) {
    return args.sideCount;
  }
  const matchTypes = catalogs.matchTypes ?? {};
  if (Object.hasOwn(matchTypes, args.matchTypeKey)) {
    return matchTypes[args.matchTypeKey]?.sides.min ?? TWO_SIDES;
  }
  return TWO_SIDES;
}

/**
 * The finishes a match of this type and side count may end with, in catalog order, after every
 * registered filter. Empty when the catalogs hold no finishes.
 */
export function allowedFinishes(
  catalogs: DeepReadonly<Catalogs>,
  args: AllowedFinishesArgs,
): FinishEntry[] {
  const ctx: FinishFilterContext = {
    matchTypeKey: args.matchTypeKey,
    sideCount: finishSideCount(catalogs, args),
    stipulationKeys: [...(args.stipulationKeys ?? [])],
  };
  let entries: readonly FinishEntry[] = Object.values(catalogs.finishes ?? {})
    .filter(
      (finish) =>
        finishAdmitsMatchType(finish, ctx.matchTypeKey) &&
        (!finish.requiresTwoSides || ctx.sideCount <= TWO_SIDES),
    )
    .sort(compareFinishes);
  for (const filter of [...filters.values()].sort(compareFilters)) {
    entries = runFilter(filter, entries, ctx);
  }
  return [...entries];
}
