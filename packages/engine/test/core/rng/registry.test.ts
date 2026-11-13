import './testStreams';
import { describe, expect, it } from 'vitest';
import {
  RngRegistry,
  assertStreamName,
  parseRngState,
  rngStateSchema,
  type RngStream,
  type StreamName,
} from '@ringside/engine';

function drawMany(stream: RngStream, count: number): number[] {
  return Array.from({ length: count }, () => stream.nextUint32());
}

function jsonRoundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('RngRegistry determinism', () => {
  it('gives identical sequences per stream for two registries with the same seed', () => {
    const first = new RngRegistry('rb-test');
    const second = new RngRegistry('rb-test');
    const streamNames: StreamName[] = ['test.alpha', 'test.beta', 'ids.per'];
    for (const name of streamNames) {
      expect(drawMany(first.stream(name), 100)).toEqual(drawMany(second.stream(name), 100));
    }
  });

  it('gives the same sequence whatever order streams are first used in', () => {
    const alphaFirst = new RngRegistry('rb-test');
    const alphaFromAlphaFirst = drawMany(alphaFirst.stream('test.alpha'), 20);
    const betaFromAlphaFirst = drawMany(alphaFirst.stream('test.beta'), 20);

    const betaFirst = new RngRegistry('rb-test');
    const betaFromBetaFirst = drawMany(betaFirst.stream('test.beta'), 20);
    const alphaFromBetaFirst = drawMany(betaFirst.stream('test.alpha'), 20);

    expect(alphaFromBetaFirst).toEqual(alphaFromAlphaFirst);
    expect(betaFromBetaFirst).toEqual(betaFromAlphaFirst);
  });

  it('keeps streams independent: 500 draws from test.alpha do not move test.beta', () => {
    const untouched = new RngRegistry('rb-test');
    const expectedBeta = drawMany(untouched.stream('test.beta'), 10);

    const busy = new RngRegistry('rb-test');
    drawMany(busy.stream('test.alpha'), 500);
    expect(drawMany(busy.stream('test.beta'), 10)).toEqual(expectedBeta);
  });

  it('gives different streams different sequences', () => {
    const registry = new RngRegistry('rb-test');
    expect(drawMany(registry.stream('test.alpha'), 10)).not.toEqual(
      drawMany(registry.stream('test.beta'), 10),
    );
  });

  it('returns the same stream object for repeat calls', () => {
    const registry = new RngRegistry('rb-test');
    expect(registry.stream('test.alpha')).toBe(registry.stream('test.alpha'));
    expect(registry.stream('test.alpha').name).toBe('test.alpha');
  });

  it('gives different first draws for 1,000 random seed pairs', () => {
    const seedSource = new RngRegistry('seed-pairs').stream('test.seeds');
    for (let pair = 0; pair < 1000; pair++) {
      const firstSeed = `seed-${String(seedSource.nextUint32())}-${String(pair)}`;
      const secondSeed = `seed-${String(seedSource.nextUint32())}-${String(pair)}-b`;
      const firstDraw = new RngRegistry(firstSeed).stream('test.alpha').nextUint32();
      const secondDraw = new RngRegistry(secondSeed).stream('test.alpha').nextUint32();
      expect(firstDraw, `seeds ${firstSeed} and ${secondSeed}`).not.toBe(secondDraw);
    }
  });
});

describe('RngRegistry serialisation', () => {
  it('continues the exact same sequence after toState -> JSON -> fromState', () => {
    const original = new RngRegistry('rb-test');
    drawMany(original.stream('test.alpha'), 37);
    drawMany(original.stream('ids.per'), 5);

    const restored = RngRegistry.fromState(jsonRoundTrip(original.toState()));

    expect(restored.seed).toBe('rb-test');
    expect(drawMany(restored.stream('test.alpha'), 50)).toEqual(
      drawMany(original.stream('test.alpha'), 50),
    );
    expect(drawMany(restored.stream('ids.per'), 50)).toEqual(
      drawMany(original.stream('ids.per'), 50),
    );
    // Never touched before saving, so not saved: re-derives from the seed and still matches.
    expect(drawMany(restored.stream('test.beta'), 50)).toEqual(
      drawMany(original.stream('test.beta'), 50),
    );
  });

  it('accepts a saved state through the constructor', () => {
    const original = new RngRegistry('rb-test');
    drawMany(original.stream('test.alpha'), 3);
    const restored = new RngRegistry('rb-test', original.toState());
    expect(drawMany(restored.stream('test.alpha'), 10)).toEqual(
      drawMany(original.stream('test.alpha'), 10),
    );
  });

  it('rejects a saved state whose seed does not match the constructor seed', () => {
    const state = new RngRegistry('rb-test').toState();
    expect(() => new RngRegistry('another-seed', state)).toThrow(/does not match/);
  });

  it('saves only touched streams, with names in sorted order', () => {
    const registry = new RngRegistry('rb-test');
    registry.stream('test.gamma').nextUint32();
    registry.stream('ids.pro');
    registry.stream('test.alpha').nextUint32();

    const state = registry.toState();
    expect(state.version).toBe(1);
    expect(state.seed).toBe('rb-test');
    expect(Object.keys(state.streams)).toEqual(['ids.pro', 'test.alpha', 'test.gamma']);
    expect(JSON.stringify(state)).toBe(JSON.stringify(jsonRoundTrip(state)));
  });

  it('serialises an unused registry as just the seed', () => {
    expect(new RngRegistry('rb-test').toState()).toEqual({
      version: 1,
      seed: 'rb-test',
      streams: {},
    });
  });
});

describe('RngRegistry snapshot and restore', () => {
  it('reproduces 50 draws after snapshot -> draws -> restore', () => {
    const registry = new RngRegistry('rb-test');
    const alpha = registry.stream('test.alpha');
    drawMany(alpha, 7);

    const snapshot = registry.snapshot();
    const firstRun = drawMany(alpha, 50);
    registry.restore(snapshot);

    expect(drawMany(alpha, 50)).toEqual(firstRun);
    expect(registry.stream('test.alpha')).toBe(alpha);
  });

  it('copies only the streams touched so far', () => {
    const registry = new RngRegistry('rb-test');
    registry.stream('test.alpha').nextUint32();
    const snapshot = registry.snapshot();
    expect([...snapshot.streams.keys()]).toEqual(['test.alpha']);
  });

  it('resets streams first touched after the snapshot and stops saving them', () => {
    const registry = new RngRegistry('rb-test');
    registry.stream('test.alpha').nextUint32();
    const stateBefore = registry.toState();
    const snapshot = registry.snapshot();

    const beta = registry.stream('test.beta');
    const betaFirstRun = drawMany(beta, 20);
    registry.restore(snapshot);

    expect(registry.toState()).toEqual(stateBefore);
    // The held stream object follows the restore back to its seed-derived start.
    expect(drawMany(beta, 20)).toEqual(betaFirstRun);
  });

  it('is unaffected by draws made after it was taken', () => {
    const registry = new RngRegistry('rb-test');
    const alpha = registry.stream('test.alpha');
    const snapshot = registry.snapshot();
    const expected = drawMany(alpha, 10);
    drawMany(alpha, 100);
    registry.restore(snapshot);
    drawMany(alpha, 3);
    registry.restore(snapshot);
    expect(drawMany(alpha, 10)).toEqual(expected);
  });

  it('refuses a snapshot from a registry with another seed', () => {
    const snapshot = new RngRegistry('other-seed').snapshot();
    expect(() => {
      new RngRegistry('rb-test').restore(snapshot);
    }).toThrow(/Cannot restore/);
  });
});

describe('stream names', () => {
  it('accepts well-formed names', () => {
    for (const name of ['test.alpha', 'ids.per', 'health.recovery', 'match.finish-roll']) {
      expect(() => {
        assertStreamName(name);
      }).not.toThrow();
    }
  });

  it('rejects malformed names loudly', () => {
    for (const name of ['', 'injuries', 'Test.alpha', 'test.', 'ids.', '.alpha', 'test alpha']) {
      expect(() => {
        assertStreamName(name);
      }).toThrow(/Invalid RNG stream name/);
    }
  });

  it('makes the registry throw on a bad dynamically built name', () => {
    const emptyPrefix = '';
    expect(() => new RngRegistry('rb-test').stream(`ids.${emptyPrefix}`)).toThrow(
      /Invalid RNG stream name "ids\."/,
    );
  });
});

describe('rngStateSchema', () => {
  const validState = {
    version: 1,
    seed: 'rb-test',
    streams: { 'test.alpha': [1, 2, 3, 4294967295] },
  };

  it('accepts a valid state', () => {
    expect(rngStateSchema.safeParse(validState).success).toBe(true);
  });

  it('rejects an unknown version, naming the field', () => {
    expect(() => parseRngState({ ...validState, version: 2 })).toThrow(
      /version: unsupported RNG state version/,
    );
  });

  it('rejects a word above uint32 range, naming the stream and index', () => {
    const corrupted = { ...validState, streams: { 'test.alpha': [1, 2, 4294967296, 4] } };
    expect(() => parseRngState(corrupted)).toThrow(
      /streams\["test\.alpha"\]\[2\]: must be an unsigned 32-bit word/,
    );
  });

  it('rejects negative, fractional and non-number words', () => {
    for (const badWord of [-1, 1.5, '7', null]) {
      const corrupted = { ...validState, streams: { 'test.beta': [1, 2, 3, badWord] } };
      expect(() => parseRngState(corrupted)).toThrow(/streams\["test\.beta"\]\[3\]/);
    }
  });

  it('rejects a stream state with the wrong number of words', () => {
    const corrupted = { ...validState, streams: { 'test.alpha': [1, 2, 3] } };
    expect(() => parseRngState(corrupted)).toThrow(/streams\["test\.alpha"\]/);
  });

  it('rejects an invalid stream name', () => {
    const corrupted = { ...validState, streams: { 'Bad Name': [1, 2, 3, 4] } };
    expect(() => parseRngState(corrupted)).toThrow(/is not a valid stream name/);
  });

  it('rejects a missing seed and unknown top-level fields', () => {
    expect(() => parseRngState({ version: 1, streams: {} })).toThrow(/seed/);
    expect(() => parseRngState({ ...validState, extra: true })).toThrow(/extra|Unrecognized/i);
  });

  it('makes fromState reject a corrupted state', () => {
    expect(() => RngRegistry.fromState({ ...validState, version: 0 })).toThrow(/version/);
  });
});
