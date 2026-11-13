/**
 * `TEST_INJURY_CATALOG`: a small injury catalog with easy numbers, one kind each for head, arms,
 * torso and legs. `worldBuilder().withInjuryCatalog()` puts it on a test world's metadata, as a
 * new game snapshots the base pack's `injuries.json` into `meta.catalogs.injuries`.
 */

import { parseContentKey } from '../../src/core/content-key';
import type { InjuryKind } from '../../src/model/catalogs';

export const TEST_INJURY_CATALOG: readonly InjuryKind[] = [
  {
    key: parseContentKey('injury.test-arm'),
    label: 'Test arm injury',
    bodyPart: 'arms',
    minDays: 10,
    maxDays: 20,
    weight: 10,
    canWorkAnglesChance: 0.5,
    severityWeights: { minor: 50, moderate: 30, severe: 20 },
  },
  {
    key: parseContentKey('injury.test-head'),
    label: 'Test head injury',
    bodyPart: 'head',
    minDays: 10,
    maxDays: 20,
    weight: 10,
    canWorkAnglesChance: 0.5,
    severityWeights: { minor: 50, moderate: 30, severe: 20 },
  },
  {
    key: parseContentKey('injury.test-leg'),
    label: 'Test leg injury',
    bodyPart: 'legs',
    minDays: 10,
    maxDays: 20,
    weight: 10,
    canWorkAnglesChance: 0.5,
    severityWeights: { minor: 50, moderate: 30, severe: 20 },
  },
  {
    key: parseContentKey('injury.test-torso'),
    label: 'Test torso injury',
    bodyPart: 'torso',
    minDays: 10,
    maxDays: 20,
    weight: 10,
    canWorkAnglesChance: 0.5,
    severityWeights: { minor: 50, moderate: 30, severe: 20 },
  },
];
