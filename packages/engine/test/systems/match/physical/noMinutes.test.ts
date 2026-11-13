// D-10 for the physical toll (MTCH4-01): no fatigue or wear trace line mentions minutes or a match
// length; the duration class says it all. Design: docs/design/physical-toll.md
import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { walkTrace, type Traced } from '../../../../src/core/trace';
import { BODY_PARTS } from '../../../../src/model/entities/person';
import {
  DURATION_CLASSES,
  WEAR_STREAM,
  computeConditionWear,
  computeFatigueGain,
  computeWearByPart,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { testId } from '../../../support/ids';

const FORBIDDEN = /minute|length/i;

function labelsOf(result: Traced<number>): string[] {
  const labels: string[] = [];
  walkTrace(result.trace, (node) => {
    labels.push(node.label);
  });
  return labels;
}

describe('physical toll traces', () => {
  it.each(DURATION_CLASSES)('never mention minutes or length (%s)', (durationClass) => {
    const tunables = createEngineTunables();
    const shared = {
      name: 'Kai Moreno',
      durationClass,
      traits: ['workhorse', 'injuryProne'] as const,
      importance: 'house' as const,
      contributions: [{ source: 'Stipulation: Ladder', personIds: null, fatigueMultiplier: 1.2 }],
      keepItSafe: true,
      matchesEarlierTonight: 1,
    };
    const fatigue = computeFatigueGain(
      { ...shared, workersInMatch: 4, stamina: 30, style: 'highFlyer' },
      { tunables },
    );
    const wear = computeConditionWear(
      {
        ...shared,
        style: 'hardcore',
        opponents: [
          { personId: testId('person', 2), name: 'Rex Hale', safety: 30, style: 'brawler' },
        ],
      },
      { tunables, rng: new RngRegistry('labels').stream(WEAR_STREAM) },
    );
    const parts = computeWearByPart(wear, { tunables });
    const labels = [fatigue, wear, ...BODY_PARTS.map((part) => parts[part])].flatMap(labelsOf);
    expect(labels.length).toBeGreaterThan(20);
    expect(labels.filter((label) => FORBIDDEN.test(label))).toEqual([]);
  });
});
