// A rival booker's side value. Design: docs/design/rival-booking.md#winners
import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { findTraceNodes, inputOf, type Traced } from '../../../../src/core/trace';
import { NO_GUT_FEELING_NOTE, rivalSideValue, WINNERS_STREAM } from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const still = createEngineTunables({ 'aip.winner.jitter': 0 });
const jittery = createEngineTunables({ 'aip.winner.jitter': 0.1 });

function values(...numbers: number[]): Traced<number>[] {
  return numbers.map((value, index) => inputOf(`Card value ${String(index)}`, value));
}

function sideValue(cardValues: Traced<number>[], tunables = still, seed = 'side-seed') {
  const result = rivalSideValue(
    { label: 'Test side', cardValues, names: cardValues.map((_, index) => `W${String(index)}`) },
    { tunables, rng: new RngRegistry(seed).stream(WINNERS_STREAM) },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('rivalSideValue', () => {
  it('is exactly the mean with no gut feeling at jitter 0, and draws no roll', () => {
    const one = sideValue(values(58.5));
    expect(one.value).toBe(58.5);
    expect(findTraceNodes(one.trace, 'roll')).toHaveLength(0);
    expect(findTraceNodes(one.trace, 'note').map((node) => node.label)).toContain(
      NO_GUT_FEELING_NOTE,
    );
    expect(sideValue(values(40, 60)).value).toBeCloseTo(50);
    expect(sideValue(values(30, 60, 90)).value).toBeCloseTo(60);
  });

  it('labels each card value line with the wrestler name', () => {
    const result = sideValue(values(30, 60, 90));
    const labels = [...findTraceNodes(result.trace, 'add')].map((node) => node.label);
    expect(labels).toEqual(['Card value, W0', 'Card value, W1', 'Card value, W2']);
  });

  it('stays within ±10% of the mean at jitter 0.1 over 1,000 seeds', () => {
    for (let seed = 0; seed < 1000; seed += 1) {
      const result = rivalSideValue(
        { label: 'Test side', cardValues: values(40, 60) },
        { tunables: jittery, rng: new RngRegistry(`seed-${String(seed)}`).stream(WINNERS_STREAM) },
      );
      expect(result.value).toBeGreaterThanOrEqual(45);
      expect(result.value).toBeLessThanOrEqual(55);
    }
  });

  it('records one gut feeling roll and replays with jitter on', () => {
    for (const cardValues of [values(50), values(50, 70), values(20, 50, 80)]) {
      const result = sideValue(cardValues, jittery);
      const rolls = findTraceNodes(result.trace, 'roll');
      expect(rolls).toHaveLength(1);
      expect(rolls[0]?.roll.stream).toBe(WINNERS_STREAM);
      expect(rolls[0]?.label).toBe("Booker's gut feeling, Test side");
    }
  });

  it('gives the same value and trace for the same seed', () => {
    expect(sideValue(values(50, 70), jittery, 'same')).toEqual(
      sideValue(values(50, 70), jittery, 'same'),
    );
  });

  it('refuses a side with no card values', () => {
    expect(() => sideValue([])).toThrow();
  });
});
