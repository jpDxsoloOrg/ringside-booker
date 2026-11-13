// Which kind of injury someone picks up. Design: docs/design/health.md#injuries
import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../../src/core/rng/registry';
import { INJURIES_STREAM, NO_INJURY_KINDS, pickInjuryKind } from '../../../src/systems/health';
import { TEST_INJURY_CATALOG } from '../../support/injuries';
import { expectRollRecorded, expectSerialisable } from '../../support/trace';

function stream(seed = 'injury-kind-test') {
  return new RngRegistry(seed).stream(INJURIES_STREAM);
}

describe('pickInjuryKind', () => {
  it('considers every kind with its weight and rolls one', () => {
    const result = pickInjuryKind({ catalog: TEST_INJURY_CATALOG }, { rng: stream() });
    expectSerialisable(result);
    expect(TEST_INJURY_CATALOG.map((kind) => kind.key)).toContain(result.value);
    expect(expectRollRecorded(result, INJURIES_STREAM)).toMatchObject({
      kind: 'weighted',
      options: 4,
      odds: 0.25,
    });
    expect(result.trace.kind === 'decision' ? result.trace.considered.length : 0).toBe(4);
  });

  it('does not depend on the order the catalog is given in', () => {
    const reversed = [...TEST_INJURY_CATALOG].reverse();
    for (const seed of ['a', 'b', 'c', 'd']) {
      expect(pickInjuryKind({ catalog: reversed }, { rng: stream(seed) }).value).toBe(
        pickInjuryKind({ catalog: TEST_INJURY_CATALOG }, { rng: stream(seed) }).value,
      );
    }
  });

  it('returns null for an empty catalog and draws nothing', () => {
    const used = stream();
    const twin = stream();
    const result = pickInjuryKind({ catalog: [] }, { rng: used });
    expect(result.value).toBeNull();
    expect(result.trace).toMatchObject({ kind: 'decision', reason: NO_INJURY_KINDS });
    expect(used.nextUint32()).toBe(twin.nextUint32());
    expectSerialisable(result);
  });
});
