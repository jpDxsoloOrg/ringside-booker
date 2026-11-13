import type { ReactNode } from 'react';
import type { PromotionId, RegionId } from '@ringside/engine';
import { createExtensionRegistry } from '@/components/extensionRegistry';

/**
 * Extra figures beside each region of the Fan base sheet's drill-down, such as EVT5-04's "This
 * month" gains. A feature registers a column from its own folder, so the sheet never changes when
 * one arrives.
 */

/** What a column's cell is drawn from. */
export interface FanBaseColumnContext {
  /** The promotion whose fan base the sheet shows. */
  readonly promotionId: PromotionId;
}

/** One figure added to every region row. */
export interface FanBaseColumnDefinition {
  /** Unique, prefixed with the feature: `evt5.thisMonth`. */
  readonly id: string;
  /** What the figure is, in words: "This month". Shown before the figure on every row. */
  readonly label: string;
  /** The figure for one region, or null to show nothing on that row. */
  readonly render: (regionId: RegionId, context: FanBaseColumnContext) => ReactNode;
}

const columns = createExtensionRegistry<FanBaseColumnDefinition>('A fan base column');

/**
 * Adds a figure to every region row of the Fan base sheet, after any registered earlier. Returns a
 * function that removes it again; throws when the id is already taken.
 */
export function registerFanBaseColumn(definition: FanBaseColumnDefinition): () => void {
  return columns.register(definition);
}

/** Every registered column, in registration order. */
export function registeredFanBaseColumns(): readonly FanBaseColumnDefinition[] {
  return columns.list();
}

/** The registered columns, kept current as features add and remove theirs. */
export function useFanBaseColumns(): readonly FanBaseColumnDefinition[] {
  return columns.useDefinitions();
}
