/**
 * The title numbers AIP5-03's formula tests were worked out with: the bands and challenger
 * thresholds before AIP5-04's two-year title check lowered them. Pinning them keeps these tests
 * about the formulas, not about the shipped balance (`results/tunables.test.ts` checks that).
 */

import type { TunableOverrides } from '../../../../src/core/tunables/overrides';

export const WORKED_TITLE_TUNABLES: TunableOverrides = {
  'aip.titles.band2.chance': 4,
  'aip.titles.band3.chance': 12,
  'aip.titles.band4.chance': 22,
  'aip.titles.band5.chance': 34,
  'aip.titles.band6.chance': 48,
  'aip.titles.bandBeyond.chance': 60,
  'aip.titles.valid.gap': 30,
  'aip.titles.valid.floor': 40,
  'aip.titles.strong.gap': 12,
  'aip.titles.strong.floor': 62,
};
