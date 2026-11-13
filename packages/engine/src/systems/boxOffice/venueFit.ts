/**
 * How well a venue suits a show's expected crowd (EVT6-02): a plain label the booking screens show
 * next to each venue. Design: docs/design/box-office.md#venues.
 */

import type { EngineTunables } from '../tunables';

export const VENUE_FITS = ['likelySellOut', 'goodFit', 'willLookEmpty'] as const;
export type VenueFit = (typeof VENUE_FITS)[number];

const VENUE_FIT_LABELS: Readonly<Record<VenueFit, string>> = {
  likelySellOut: 'Likely sell-out',
  goodFit: 'Good fit',
  willLookEmpty: 'Will look empty',
};

/** "Likely sell-out", "Good fit", "Will look empty". */
export function venueFitLabel(fit: VenueFit): string {
  return VENUE_FIT_LABELS[fit];
}

/**
 * `likelySellOut` when the expected crowd reaches `capacity × boxOffice.fit.sellOutAt`,
 * `willLookEmpty` when the capacity is at least `expected × boxOffice.fit.emptyAt`, else `goodFit`.
 * A sell-out wins when both hold.
 */
export function venueFit(expected: number, capacity: number, tunables: EngineTunables): VenueFit {
  if (expected >= capacity * tunables.get('boxOffice.fit.sellOutAt')) {
    return 'likelySellOut';
  }
  if (capacity >= expected * tunables.get('boxOffice.fit.emptyAt')) {
    return 'willLookEmpty';
  }
  return 'goodFit';
}
