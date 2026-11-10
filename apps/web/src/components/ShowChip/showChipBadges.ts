import type { ReactNode } from 'react';
import type { CalendarShow } from '@ringside/engine';
import { createExtensionRegistry, sortedByOrder } from '../extensionRegistry';

/** What a chip badge is drawn from. */
export interface ShowChipBadgeContext {
  readonly show: CalendarShow;
}

/** One small badge another feature adds to the end of every show chip, such as "Taped". */
export interface ShowChipBadgeDefinition {
  /** Unique, such as `hype.level`. */
  readonly id: string;
  /** Its place among the badges, lowest first. */
  readonly order: number;
  /**
   * Draws the badge, or returns null to leave this show without one. It sits inside the chip's
   * button, so it must be plain text or a `Badge`, never a control of its own.
   */
  readonly render: (context: ShowChipBadgeContext) => ReactNode;
}

const registry = createExtensionRegistry<ShowChipBadgeDefinition>('A show chip badge');

/**
 * Adds a badge to every show chip, wherever one is drawn. Returns a function that removes it
 * again. Throws when the id is already taken.
 */
export function registerShowChipBadge(definition: ShowChipBadgeDefinition): () => void {
  return registry.register(definition);
}

/** Every registered chip badge, in registration order. */
export function registeredShowChipBadges(): readonly ShowChipBadgeDefinition[] {
  return registry.list();
}

/** The registered chip badges in display order, kept current as features add and remove theirs. */
export function useShowChipBadges(): readonly ShowChipBadgeDefinition[] {
  return sortedByOrder(registry.useDefinitions());
}
