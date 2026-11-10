import type { EventImportance } from '@ringside/engine';

/** How each importance reads on screen. Colour never carries it alone: this label goes with it. */
export const IMPORTANCE_LABELS: Readonly<Record<EventImportance, string>> = {
  house: 'House show',
  minor: 'Minor',
  regular: 'Regular',
  major: 'Major',
  flagship: 'Flagship',
};

/** Every importance, lowest first: the order of the calendar's legend. */
export const IMPORTANCE_ORDER: readonly EventImportance[] = [
  'house',
  'minor',
  'regular',
  'major',
  'flagship',
];
