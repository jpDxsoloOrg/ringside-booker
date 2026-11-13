// Live merch. Design: docs/design/box-office.md#live-merch
import { describe, expect, it } from 'vitest';
import type { Traced } from '../../../../src/core/trace';
import { computeLiveMerch } from '../../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectRollRecorded, expectSerialisable, expectTraceReplays } from '../../../support/trace';
import { merchStream, type CountingStream } from './rngSupport';

const DEFAULTS = createEngineTunables();
const NO_SPREAD = createEngineTunables({ 'boxOffice.merch.spread': 0 });

function merch(
  attendance: number,
  showScore: number,
  options: { tunables?: EngineTunables; rng?: CountingStream } = {},
): { result: Traced<number>; rng: CountingStream } {
  const rng = options.rng ?? merchStream('merch-test');
  const result = computeLiveMerch(
    { attendance, showScore },
    { tunables: options.tunables ?? DEFAULTS, rng },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return { result, rng };
}

describe('computeLiveMerch', () => {
  it('is $5 a head after an average show with no swing, counting the crowd once', () => {
    expect(merch(1000, 50, { tunables: NO_SPREAD }).result.value).toBe(500_000);
  });

  it('sells more after a better show', () => {
    expect(merch(1000, 0, { tunables: NO_SPREAD }).result.value).toBe(400_000);
    expect(merch(1000, 100, { tunables: NO_SPREAD }).result.value).toBe(600_000);
    expect(merch(1000, 150, { tunables: NO_SPREAD }).result.value).toBe(600_000);
  });

  it('sells nothing to an empty building, and still draws once', () => {
    const { result, rng } = merch(0, 80);
    expect(result.value).toBe(0);
    expect(rng.draws).toBe(1);
  });

  it('treats 0 as 0 for every tunable', () => {
    const perHead = createEngineTunables({ 'boxOffice.merch.perHead': 0 });
    expect(merch(1000, 50, { tunables: perHead }).result.value).toBe(0);
    const flat = createEngineTunables({
      'boxOffice.merch.spread': 0,
      'boxOffice.merch.qualityLow': 0,
      'boxOffice.merch.qualityHigh': 0,
    });
    expect(merch(1000, 50, { tunables: flat }).result.value).toBe(0);
  });

  it('stays within the spread', () => {
    for (let index = 0; index < 50; index += 1) {
      const { result } = merch(1000, 50, { rng: merchStream(`spread-${String(index)}`) });
      expect(Number.isInteger(result.value)).toBe(true);
      expect(result.value).toBeGreaterThanOrEqual(475_000);
      expect(result.value).toBeLessThanOrEqual(525_000);
    }
  });

  it('reaches the most the tunables allow', () => {
    const tunables = createEngineTunables({
      'boxOffice.merch.perHead': 100_000,
      'boxOffice.merch.qualityHigh': 3,
      'boxOffice.merch.spread': 0,
    });
    expect(merch(200_000, 100, { tunables }).result.value).toBe(200_000 * 100_000 * 3);
  });

  it('records the roll on the boxoffice.merch stream', () => {
    const roll = expectRollRecorded(merch(500, 60).result, 'boxoffice.merch');
    expect(roll.label).toBe('Merch stand on the night');
  });

  it('pins the takings for a fixed seed, so a stream change is noticed', () => {
    expect(merch(1000, 50, { rng: merchStream('pinned') }).result.value).toBe(496_436);
  });
});
