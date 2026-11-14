// Region audience. Design: docs/design/broadcast.md#audience
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import {
  NOBODY_KNOWS_YOU_NOTE,
  regionAudience,
  type RegionAudienceInputs,
} from '../../../../src/systems/broadcast';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function region(
  overrides: Partial<RegionAudienceInputs> = {},
  tunables: EngineTunables = DEFAULTS,
): ReturnType<typeof regionAudience> {
  return regionAudience(
    {
      regionName: 'Test Region',
      population: 1_000_000,
      wrestlingInterest: 50,
      popularity: 40,
      ...overrides,
    },
    { tunables },
  );
}

describe('regionAudience', () => {
  it('is people who care × (popularity ÷ 100) ^ power × the base share', () => {
    const result = region();
    const share = DEFAULTS.get('broadcast.audience.baseShare');
    const power = DEFAULTS.get('broadcast.audience.popularityPower');
    expect(result.value).toBeCloseTo(500_000 * 0.4 ** power * share, 6);
    expectTraceReplays(result);
  });

  it('lists people, interest, popularity, the curve and the share, in that order', () => {
    const result = region();
    const labels = result.trace.children?.map((node) => node.label);
    expect(labels).toEqual([
      'People in Test Region',
      'Care about wrestling (50%)',
      'Your popularity there (40)',
      'Share a top network draws',
    ]);
    expectTraceContains(result, { kind: 'power', label: 'Popularity curve' });
    expect(result.trace.docRef).toBe('broadcast.md#audience');
  });

  it('gives 0 with a note when nobody in the region knows the promotion', () => {
    const result = region({ popularity: 0 });
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: NOBODY_KNOWS_YOU_NOTE });
    expectTraceReplays(result);
  });

  it('draws the whole base share of the people who care at popularity 100', () => {
    const result = region({ popularity: 100 });
    expect(result.value).toBeCloseTo(500_000 * DEFAULTS.get('broadcast.audience.baseShare'), 6);
    expect(findTraceNodes(result.trace, 'note')).toHaveLength(0);
  });

  it('is a straight line in popularity when the power is 1', () => {
    const linear = createEngineTunables({ 'broadcast.audience.popularityPower': 1 });
    const half = region({ popularity: 50 }, linear).value;
    const full = region({ popularity: 100 }, linear).value;
    expect(half * 2).toBeCloseTo(full, 6);
  });

  it('turns popularity into viewers more sharply with a higher power', () => {
    const steep = createEngineTunables({ 'broadcast.audience.popularityPower': 3 });
    expect(region({}, steep).value).toBeLessThan(region().value);
  });

  it('gives 0 when the base share is 0, or nobody cares about wrestling', () => {
    const noShare = createEngineTunables({ 'broadcast.audience.baseShare': 0 });
    expect(region({}, noShare).value).toBe(0);
    expect(region({ wrestlingInterest: 0 }).value).toBe(0);
    expect(region({ population: 0 }).value).toBe(0);
  });

  it('is plain JSON', () => {
    expectSerialisable(region());
  });
});
