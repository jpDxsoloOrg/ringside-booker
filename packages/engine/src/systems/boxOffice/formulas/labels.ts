/**
 * The words the box office formulas use for a show's size, shared with the screens that show a
 * forecast. Design: docs/design/box-office.md#forecast.
 */

import type { EventImportance } from '../../../model/entities/event-definition';

const SHOW_SIZE_LABELS: Readonly<Record<EventImportance, string>> = {
  house: 'House show',
  minor: 'Minor show',
  regular: 'Regular show',
  major: 'Major show',
  flagship: 'Flagship show',
};

/** "Regular show", "Flagship show". */
export function showSizeLabel(importance: EventImportance): string {
  return SHOW_SIZE_LABELS[importance];
}
