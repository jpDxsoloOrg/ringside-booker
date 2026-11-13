// An injury's Why? in the panel's wording (WRK6-03). Design: docs/design/health.md#injuries
import {
  computeInjuryDays,
  createEngineTunables,
  decideInjurySeverity,
  INJURIES_STREAM,
  medicalCareLabel,
  RngRegistry,
} from '@ringside/engine';
import { describe, expect, it } from 'vitest';
import { traceToText } from './traceToText';

function daysText(traits: readonly ('durable' | 'injuryProne')[]): string {
  const rng = new RngRegistry('injury-wording').stream(INJURIES_STREAM);
  const severity = decideInjurySeverity(
    { weights: { minor: 50, moderate: 30, severe: 20 } },
    { rng },
  );
  const days = computeInjuryDays(
    {
      kind: { label: 'Sprained ankle', minDays: 7, maxDays: 21 },
      severity,
      traits,
      medicalLevel: 2,
      medicalLabel: medicalCareLabel(2, 'Apex Wrestling'),
    },
    { tunables: createEngineTunables(), rng },
  );
  return traceToText(days.trace);
}

describe('an injury’s days out, in words', () => {
  it('names the catalog range and roll, the severity roll, the trait line and the medical care', () => {
    const text = daysText([]);
    expect(text).toMatch(/^Days out: \d+ days?/);
    expect(text).toMatch(/Sprained ankle: 7–21 days: rolled \d+ on 7–21/);
    expect(text).toMatch(/Severity roll/);
    expect(text).toContain('Neither durable nor injury prone');
    expect(text).toContain('Medical care: Apex Wrestling (level 2)');
    expect(text).toContain('At least a day');
  });

  it('says when the worker is durable', () => {
    expect(daysText(['durable'])).toContain('Durable');
  });
});
