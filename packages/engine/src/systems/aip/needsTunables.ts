/**
 * Roster needs tunables (AIP1-04): how many workers a promotion's shows call for, how they spread
 * over the card, and when a gap in alignment, a division, a title or the crew becomes a need.
 * Spread into `aipTunables`. Design: docs/design/rival-desk.md#needs.
 */

import { defineTunables } from '../../core/tunables/define';

const CATEGORY = 'Rival desk';
export const NEEDS_DOC_REF = 'rival-desk.md#needs';

const BAND_SHARE = {
  kind: 'number',
  min: 0,
  max: 1,
  unit: 'ratio',
  category: CATEGORY,
  docRef: NEEDS_DOC_REF,
} as const;

const SEVERITY = {
  kind: 'number',
  min: 0,
  max: 100,
  unit: 'points',
  category: CATEGORY,
  docRef: NEEDS_DOC_REF,
} as const;

const CREW_MINIMUM = {
  kind: 'integer',
  min: 0,
  max: 10,
  unit: 'count',
  category: CATEGORY,
  docRef: NEEDS_DOC_REF,
} as const;

export const needsTunables = defineTunables({
  'aip.needs.workersPerSlot': {
    kind: 'number',
    default: 2,
    min: 0,
    max: 6,
    unit: 'ratio',
    category: CATEGORY,
    description: 'Wrestlers a promotion wants on its roster for each slot of its largest show',
    docRef: NEEDS_DOC_REF,
  },
  'aip.needs.defaultSlots': {
    kind: 'integer',
    default: 6,
    min: 0,
    max: 12,
    unit: 'count',
    category: CATEGORY,
    description: 'Slots counted for a promotion that has no active shows',
    docRef: NEEDS_DOC_REF,
  },
  'aip.needs.bandShare.mainEvent': {
    ...BAND_SHARE,
    default: 0.12,
    description: 'Share of the wanted roster pushed in the main event',
  },
  'aip.needs.bandShare.upperCard': {
    ...BAND_SHARE,
    default: 0.2,
    description: 'Share of the wanted roster pushed on the upper card',
  },
  'aip.needs.bandShare.midCard': {
    ...BAND_SHARE,
    default: 0.33,
    description: 'Share of the wanted roster pushed in the mid card',
  },
  'aip.needs.bandShare.lowerCard': {
    ...BAND_SHARE,
    default: 0.2,
    description: 'Share of the wanted roster pushed on the lower card',
  },
  'aip.needs.bandShare.enhancement': {
    ...BAND_SHARE,
    default: 0.15,
    description: 'Share of the wanted roster doing enhancement work',
  },
  'aip.needs.maxAlignmentGap': {
    kind: 'integer',
    default: 3,
    min: 0,
    max: 20,
    unit: 'count',
    category: CATEGORY,
    description:
      'Most faces over heels (or heels over faces) a roster can have before it is a need',
    docRef: NEEDS_DOC_REF,
  },
  'aip.needs.alignmentSeverityPerWorker': {
    ...SEVERITY,
    default: 15,
    description: 'How pressing an alignment gap is for each worker past the gap allowed',
  },
  'aip.needs.minPerGenderDivision': {
    kind: 'integer',
    default: 4,
    min: 0,
    max: 20,
    unit: 'count',
    category: CATEGORY,
    description: 'Fewest available wrestlers a division with a title wants; 0 never makes a need',
    docRef: NEEDS_DOC_REF,
  },
  'aip.needs.contractEndingDays': {
    kind: 'integer',
    default: 60,
    min: 0,
    max: 365,
    unit: 'days',
    category: CATEGORY,
    description: "How soon a champion's contract must end to count as a need",
    docRef: NEEDS_DOC_REF,
  },
  'aip.needs.championUnfitSeverity': {
    ...SEVERITY,
    default: 80,
    description: 'How pressing a champion who cannot defend is',
  },
  'aip.needs.championEndingSeverity': {
    ...SEVERITY,
    default: 60,
    description: 'How pressing a champion whose contract is ending is',
  },
  'aip.needs.minReferees': {
    ...CREW_MINIMUM,
    default: 2,
    description: 'Fewest referees a promotion wants; 0 never makes a need',
  },
  'aip.needs.minAnnouncers': {
    ...CREW_MINIMUM,
    default: 1,
    description: 'Fewest announcers a promotion wants; 0 never makes a need',
  },
  'aip.needs.minProducers': {
    ...CREW_MINIMUM,
    default: 0,
    description: 'Fewest producers a promotion wants; 0 never makes a need',
  },
  'aip.needs.minSeverity': {
    ...SEVERITY,
    default: 10,
    description: 'Needs less pressing than this are left out of the review',
  },
});
