import type { ReactNode } from 'react';
import type { ProductionOverview, PromotionId } from '@ringside/engine';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';

/**
 * The Production screen's header slot: the KPI cards above the area rows. ECO7 draws its own three
 * (popularity ceiling 20, monthly overhead 30, show production 40); other features add theirs from
 * their own folders with `registerProductionHeaderItem`, without editing the screen. EVT4's
 * show-quality ceiling and bonus-slot card can sit first at order 10.
 */

/** What a header item is drawn from. */
export interface ProductionHeaderItemProps {
  /** The promotion whose production is shown: the one the local seat runs. */
  readonly promotionId: PromotionId;
  /** The screen's `production.overview` answer, so an item need not ask for it again. */
  readonly overview: ProductionOverview;
}

/** One card in the header. */
export interface ProductionHeaderItemDefinition {
  /** Unique, prefixed with the feature: `cardFlow.showCeiling`. */
  readonly id: string;
  /** Its place in the header, lowest first; ties go in the order registered. */
  readonly order: number;
  /** Draws a `KpiCard`, or returns null to leave the card out. May run its own queries. */
  readonly render: (props: ProductionHeaderItemProps) => ReactNode;
}

const items = createExtensionRegistry<ProductionHeaderItemDefinition>('A production header item');

/** The ids the screen registers itself; a test reset keeps them. */
const builtinIds = new Set<string>();
/** How to take each added (not built-in) item out again, for the test reset. */
const removers = new Map<string, () => void>();

/**
 * Adds a card to the Production header, in `order` among the others. Returns a function that
 * removes it again; throws when the id is already taken.
 */
export function registerProductionHeaderItem(
  definition: ProductionHeaderItemDefinition,
): () => void {
  const remove = items.register(definition);
  removers.set(definition.id, remove);
  return () => {
    removers.delete(definition.id);
    remove();
  };
}

/** For the screen's own cards (`ProductionHeader.tsx`): kept by the test reset. */
export function registerBuiltinProductionHeaderItem(
  definition: ProductionHeaderItemDefinition,
): void {
  // A module loaded twice (a hot reload in development) keeps the first registration.
  if (builtinIds.has(definition.id)) return;
  builtinIds.add(definition.id);
  items.register(definition);
}

/** Every header item, built-in and added, lowest `order` first. */
export function listProductionHeaderItems(): readonly ProductionHeaderItemDefinition[] {
  return sortedByOrder(items.list());
}

/** The header items in order, kept current as features add and remove theirs. */
export function useProductionHeaderItems(): readonly ProductionHeaderItemDefinition[] {
  return sortedByOrder(items.useDefinitions());
}

/** Tests only: removes every item a test added, keeping the built-in ones. */
export function resetProductionHeaderRegistryForTests(): void {
  for (const [id, remove] of [...removers]) {
    if (!builtinIds.has(id)) remove();
  }
  removers.clear();
}
