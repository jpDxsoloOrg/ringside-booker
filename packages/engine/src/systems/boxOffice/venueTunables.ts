/**
 * The box office's venue numbers (EVT6-02): the capacity of each generic local venue size, the
 * thresholds of the venue fit labels, the headroom the venue pick leaves and how far ahead rival
 * shows get a venue (EVT6-03). Spread into `boxOfficeTunables`. Design:
 * docs/design/box-office.md#venues, #generic-venues and #pick.
 */

import { defineTunables } from '../../core/tunables/define';

const BOX_OFFICE_CATEGORY = 'Box office';
const VENUES_DOC = 'box-office.md#venues';
const GENERIC_VENUES_DOC = 'box-office.md#generic-venues';
const PICK_DOC = 'box-office.md#pick';

const GENERIC_CAPACITY_RANGE = {
  kind: 'integer',
  min: 1,
  max: 200000,
  unit: 'count',
  category: BOX_OFFICE_CATEGORY,
  docRef: GENERIC_VENUES_DOC,
} as const;

export const venueTunables = defineTunables({
  'boxOffice.generic.room.capacity': {
    ...GENERIC_CAPACITY_RANGE,
    default: 150,
    description: 'People a local room holds',
  },
  'boxOffice.generic.smallHall.capacity': {
    ...GENERIC_CAPACITY_RANGE,
    default: 500,
    description: 'People a local small hall holds',
  },
  'boxOffice.generic.hall.capacity': {
    ...GENERIC_CAPACITY_RANGE,
    default: 1200,
    description: 'People a local hall holds',
  },
  'boxOffice.generic.largeHall.capacity': {
    ...GENERIC_CAPACITY_RANGE,
    default: 3000,
    description: 'People a local large hall holds',
  },
  'boxOffice.generic.smallArena.capacity': {
    ...GENERIC_CAPACITY_RANGE,
    default: 6000,
    description: 'People a local small arena holds',
  },
  'boxOffice.generic.arena.capacity': {
    ...GENERIC_CAPACITY_RANGE,
    default: 12000,
    description: 'People a local arena holds',
  },
  'boxOffice.generic.largeArena.capacity': {
    ...GENERIC_CAPACITY_RANGE,
    default: 20000,
    description: 'People a local large arena holds',
  },
  'boxOffice.generic.stadium.capacity': {
    ...GENERIC_CAPACITY_RANGE,
    default: 45000,
    description: 'People a local stadium holds',
  },
  'boxOffice.fit.sellOutAt': {
    kind: 'number',
    default: 1,
    min: 0.5,
    max: 1.5,
    step: 0.05,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'Expected crowd, as a share of capacity, at which a venue is a likely sell-out',
    docRef: VENUES_DOC,
  },
  'boxOffice.fit.emptyAt': {
    kind: 'number',
    default: 3,
    min: 1,
    max: 10,
    step: 0.1,
    unit: 'multiplier',
    category: BOX_OFFICE_CATEGORY,
    description: 'Capacity, as a multiple of the expected crowd, at which a venue will look empty',
    docRef: VENUES_DOC,
  },
  'boxOffice.pick.headroom': {
    kind: 'number',
    default: 1.1,
    min: 1,
    max: 3,
    step: 0.05,
    unit: 'multiplier',
    category: BOX_OFFICE_CATEGORY,
    description: 'Room left for a good night when sizing a venue',
    docRef: PICK_DOC,
  },
  'boxOffice.rivalVenueLeadDays': {
    kind: 'integer',
    default: 14,
    min: 0,
    max: 90,
    unit: 'days',
    category: BOX_OFFICE_CATEGORY,
    description: 'How far ahead rival shows are given a venue',
    docRef: PICK_DOC,
  },
});
