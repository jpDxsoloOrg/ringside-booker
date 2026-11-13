import type { ReactNode } from 'react';
import type { BookingCard, BookingValidation, EventInstanceId } from '@ringside/engine';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';

/** What a booking panel is drawn from. */
export interface BookingPanelContext {
  readonly eventInstanceId: EventInstanceId;
  /** The card as `booking.card` answered it. */
  readonly card: BookingCard;
  /** `booking.validate`'s answer, or null while it loads. */
  readonly validation: BookingValidation | null;
}

/**
 * Where a panel sits: `side` under the checklist (beside the card on desktop), `below` under the
 * card. On a phone both are in the single column, side panels first.
 */
export type BookingPanelPlacement = 'side' | 'below';

/** One panel another feature adds to the booking screen, such as the forecast or the venue. */
export interface BookingPanelDefinition {
  /** Unique, prefixed with the feature: `forecast.card`. */
  readonly id: string;
  /** Its place among the panels of its placement, lowest first. */
  readonly order: number;
  readonly placement: BookingPanelPlacement;
  /** Heads the panel and names it as a region. Without it the panel draws its own heading. */
  readonly title?: string;
  /** Draws the panel, or returns null to leave it out for this show. */
  readonly render: (context: BookingPanelContext) => ReactNode;
  /**
   * One short line for the phone's sticky bar, above "N problems · Run the show" ("Forecast: 74, B").
   * Tapping it opens the panel in a bottom sheet. Return null to say nothing for this show.
   */
  readonly phoneSummary?: (context: BookingPanelContext) => string | null;
}

const panels = createExtensionRegistry<BookingPanelDefinition>('A booking panel');

/**
 * Adds a panel to the booking screen without editing it. Returns a function that removes it
 * again; throws when the id is taken. Register from a file imported by `../sections/index.ts`.
 */
export function registerBookingPanel(definition: BookingPanelDefinition): () => void {
  return panels.register(definition);
}

/** Every registered panel, in registration order. */
export function registeredBookingPanels(): readonly BookingPanelDefinition[] {
  return panels.list();
}

/** The registered panels, lowest `order` first, kept current as features add theirs. */
export function useBookingPanels(): readonly BookingPanelDefinition[] {
  return sortedByOrder(panels.useDefinitions());
}
