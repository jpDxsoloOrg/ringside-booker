/**
 * The popularity reach seam (MTCH3-03): extra regions a match's popularity change reaches beyond
 * the show's own region and its neighbours.
 *
 * A reach provider says which other regions saw the match and how much of the change each gets,
 * with a reason the player reads ("TV reach: Coastline Sports"). EVT5 registers one for TV
 * coverage; without any provider only the show region and its neighbours move. Providers are
 * module-level, like the rating and show night registries: a system registers at module load and
 * tests reset what they added.
 *
 * Design: docs/design/match-aftermath.md#regional-spread.
 */

import type { GameDate } from '../../../core/date';
import { RegistryError } from '../../../core/errors';
import type { EventInstanceId, PromotionId, RegionId } from '../../../core/ids';
import { PHASE_ID_PATTERN } from '../../../core/pipeline/phase';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { GameWorldView } from '../../../model/tables';

/** The match a provider is asked about. */
export interface ReachContext {
  readonly promotionId: PromotionId;
  /** The show, or null for a Match lab match on no show. */
  readonly eventInstanceId: EventInstanceId | null;
  /** The show's region. */
  readonly regionId: RegionId;
  readonly televised: boolean;
  readonly importance: EventImportance;
  readonly date: GameDate;
}

/** One region a provider adds. */
export interface ReachRegion {
  readonly regionId: RegionId;
  /** The share of the change the region gets, 0 to 1. Values outside are clamped with a note. */
  readonly weight: number;
  /** Plain words for the player, such as "TV reach: Coastline Sports". */
  readonly reason: string;
}

export interface PopularityReachProvider {
  /** `system.camelName`, like a phase id, for example `promoPop.tvReach`. */
  readonly id: string;
  /** Lower runs first; equal orders run by id. */
  readonly order: number;
  /** The regions this match reaches. Must read only; never writes. */
  readonly regionsFor: (read: GameWorldView, ctx: ReachContext) => readonly ReachRegion[];
}

const providers = new Map<string, PopularityReachProvider>();

/**
 * Registers a reach provider. Returns a function that unregisters it.
 *
 * @throws RegistryError for a malformed id, a non-finite order, or an id already registered.
 */
export function registerPopularityReach(provider: PopularityReachProvider): () => void {
  if (!PHASE_ID_PATTERN.test(provider.id)) {
    throw new RegistryError(
      `Popularity reach provider id "${provider.id}" must look like system.camelName`,
      { id: provider.id },
    );
  }
  if (!Number.isFinite(provider.order)) {
    throw new RegistryError(`Popularity reach provider ${provider.id} needs a finite order`, {
      id: provider.id,
    });
  }
  if (providers.has(provider.id)) {
    throw new RegistryError(`Popularity reach provider ${provider.id} is already registered`, {
      id: provider.id,
    });
  }
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) {
      providers.delete(provider.id);
    }
  };
}

/** Every registered provider, in the order they run: by `order`, then by id. */
export function listPopularityReach(): readonly PopularityReachProvider[] {
  return [...providers.values()].sort(
    (left, right) =>
      left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

/** Removes every provider. Tests only. */
export function resetPopularityReachForTests(): void {
  providers.clear();
}
