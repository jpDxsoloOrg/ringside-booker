import type { CalendarShow } from '@ringside/engine';

/**
 * A show's card size in words: "6 main slots", or "8 main slots + 1 pre-show". A card is slots,
 * never a running time (design decision D-10). The smallest format has three main slots, so there
 * is no singular form.
 */
export function slotsText(format: CalendarShow['format']): string {
  const main = `${String(format.slots)} main slots`;
  return format.preShowSlots > 0 ? `${main} + ${String(format.preShowSlots)} pre-show` : main;
}
