import type { RefObject } from 'react';

/**
 * From about this many rows a table should render only the rows in view. The full roster of a big
 * world runs past it; most other tables never get near it.
 */
export const WINDOWING_ROW_THRESHOLD = 300;

/** The slice of rows the table body renders, plus the space the skipped rows would take. */
export interface RowWindow<Item> {
  /** The rows to render, in display order. */
  readonly items: readonly Item[];
  /** Index of `items[0]` in the full list, for keyboard navigation and `aria-rowindex`. */
  readonly startIndex: number;
  /** Height in pixels of the rows skipped above the window. */
  readonly spaceBefore: number;
  /** Height in pixels of the rows skipped below the window. */
  readonly spaceAfter: number;
}

/**
 * The windowing hook point for DataTable's desktop body. Today it returns every row and no
 * spacing, which is what every table up to {@link WINDOWING_ROW_THRESHOLD} rows wants.
 *
 * To window a 300+ row roster later, add `@tanstack/react-virtual` (pinned, like every
 * dependency) and change only this function:
 *
 * 1. Call `useVirtualizer({ count: items.length, getScrollElement: () => scrollElement.current,
 *    estimateSize: () => rowHeightPx, overscan: 8 })`. The scroller DataTableTable already passes
 *    in is the element that scrolls, and the sticky header lives inside it.
 * 2. Return `items.slice(first.index, last.index + 1)` from `getVirtualItems()`, `startIndex` as
 *    `first.index`, `spaceBefore` as `first.start` and `spaceAfter` as
 *    `getTotalSize() - last.end`.
 * 3. Only switch on at or above the threshold, so short tables keep plain markup.
 *
 * DataTableTable renders a spacer row above and below the window whenever the spacing is above
 * zero. Each spacer gets its height from an SVG's `height` attribute, so no style is written from
 * script. Keyboard navigation already works on row ids across the full list, so
 * arrow keys reach rows outside the window and `scrollIntoView` brings them in.
 */
export function useRowWindow<Item>(
  items: readonly Item[],
  // Kept in the signature so callers already pass the scroll container the virtualizer will need.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used once windowing is switched on
  scrollElement: RefObject<HTMLElement | null>,
): RowWindow<Item> {
  return { items, startIndex: 0, spaceBefore: 0, spaceAfter: 0 };
}
