// Trace kinds with store limits of their own (AIP5-06). Design:
// docs/design/calculation-traces.md#per-kind-retention
import { describe, expect, it } from 'vitest';
import { RegistryError } from '../../src/core/errors';
import { WINNER_TRACE_KIND, TITLE_TRACE_KIND } from '../../src/systems/aip';
import {
  engineTraceStoreLimits,
  registerTraceKindLimits,
  traceKindLimitsFrom,
} from '../../src/systems/traceKindLimits';
import { createEngineTunables } from '../../src/systems/tunables';

describe('trace kind limits', () => {
  it('give rival results their own limits from the results tunables', () => {
    const limits = engineTraceStoreLimits(
      createEngineTunables({ 'aip.results.fullTraces': 900, 'aip.results.fullTraceChars': 0 }),
    );
    expect(limits).toMatchObject({ retentionPerKind: 200, bytesPerKind: 500_000 });
    for (const kind of [WINNER_TRACE_KIND, TITLE_TRACE_KIND]) {
      expect(limits.perKind?.[kind]).toEqual({ retentionPerKind: 900, bytesPerKind: 0 });
    }
  });

  it('refuse a second source with the same id or for a kind already covered', () => {
    const remove = registerTraceKindLimits({
      id: 'test.kinds',
      kinds: ['test.alpha'],
      limits: () => ({ retentionPerKind: 5, bytesPerKind: 50 }),
    });
    try {
      expect(traceKindLimitsFrom(createEngineTunables())['test.alpha']).toEqual({
        retentionPerKind: 5,
        bytesPerKind: 50,
      });
      expect(() =>
        registerTraceKindLimits({
          id: 'test.kinds',
          kinds: ['test.beta'],
          limits: () => ({ retentionPerKind: 1, bytesPerKind: 1 }),
        }),
      ).toThrow(RegistryError);
      expect(() =>
        registerTraceKindLimits({
          id: 'test.other',
          kinds: [WINNER_TRACE_KIND],
          limits: () => ({ retentionPerKind: 1, bytesPerKind: 1 }),
        }),
      ).toThrow(RegistryError);
    } finally {
      remove();
    }
    expect(traceKindLimitsFrom(createEngineTunables())['test.alpha']).toBeUndefined();
  });
});
