import type { ReactNode } from 'react';
import type { OfficeDashboard, PromotionId } from '@ringside/engine';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';

/**
 * The Office's panels. Every feature adds its own panel from its own folder with
 * `registerOfficePanel` (and one import line in `./index.ts`), so the Office screen itself never
 * changes when a feature arrives. See apps/web/src/app/README.md#the-office for the order bands.
 */

/** Which column a panel sits in on desktop: the wide main one or the narrower side one. */
export type OfficePanelColumn = 'main' | 'side';

/** What a panel is drawn from. */
export interface OfficePanelContext {
  /** The promotion the local seat runs, or null for a seat that runs none. */
  readonly promotionId: PromotionId | null;
  /** The Office's `office.dashboard` answer. */
  readonly dashboard: OfficeDashboard;
  /** True below `--bp-mobile`, where the two columns become one. */
  readonly isPhone: boolean;
  /**
   * Opens the Office's one Fan base sheet for a promotion (DAY2-05). A panel never draws a sheet
   * of its own per row.
   */
  readonly openFanBase?: (promotionId: PromotionId) => void;
}

/** One panel on the Office. */
export interface OfficePanelDefinition {
  /** Unique, prefixed with the feature: `day2.worldClock`. Named in the frame's error details. */
  readonly id: string;
  /**
   * Its place, lowest first; ties go in the order registered. On a phone both columns become one,
   * still in this order. Bands: 10–29 the Office itself, 30–49 roster and people, 50–69 shows,
   * 70–89 business, 90 and up news and social.
   */
  readonly order: number;
  readonly column: OfficePanelColumn;
  /** Leave the panel out for a seat that runs no promotion. True by default. */
  readonly requiresPromotion?: boolean;
  /** Draws the panel, or returns null to leave it out (no empty frame is drawn). */
  readonly render: (context: OfficePanelContext) => ReactNode;
}

const panels = createExtensionRegistry<OfficePanelDefinition>('An office panel');

/**
 * Adds a panel to the Office, in `order` within its column. Returns a function that removes it
 * again; throws when the id is already taken.
 */
export function registerOfficePanel(definition: OfficePanelDefinition): () => void {
  return panels.register(definition);
}

/** Every registered panel, in registration order. */
export function registeredOfficePanels(): readonly OfficePanelDefinition[] {
  return panels.list();
}

/** The registered panels, kept current as features add and remove theirs. */
export function useOfficePanels(): readonly OfficePanelDefinition[] {
  return panels.useDefinitions();
}

/** Panels lowest `order` first, ties in the order given (registration order). */
export function orderOfficePanels(
  definitions: readonly OfficePanelDefinition[],
): readonly OfficePanelDefinition[] {
  return sortedByOrder(definitions);
}

/** Whether a panel is drawn for this seat: promotion-only panels are left out for a seat with none. */
export function officePanelApplies(
  definition: OfficePanelDefinition,
  promotionId: PromotionId | null,
): boolean {
  return promotionId !== null || definition.requiresPromotion === false;
}
