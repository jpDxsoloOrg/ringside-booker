import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, worldHash, type EngineState } from '@ringside/engine';
import { defaultSystems } from '../../../src/systems';
import { rosterWorld } from '../../support/worlds';

function rosterState(): EngineState {
  return initialEngineState(rosterWorld(6).world);
}

/** A deep copy of a JSON value with every object's keys in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => reverseKeys(entry));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]: [string, unknown]) => [key, reverseKeys(entry)]),
    );
  }
  return value;
}

/** The state with the first person's fatigue replaced. */
function withFirstFatigue(state: EngineState, fatigue: number): EngineState {
  const [first, ...rest] = state.world.tables.people;
  if (first === undefined) {
    throw new Error('The roster fixture has no people');
  }
  return {
    ...state,
    world: {
      ...state.world,
      tables: { ...state.world.tables, people: [{ ...first, fatigue }, ...rest] },
    },
  };
}

describe('worldHash', () => {
  it('is 16 lowercase hex digits and the same for two equal states', () => {
    const hash = worldHash(rosterState());
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(worldHash(rosterState())).toBe(hash);
  });

  it('changes when one fatigue value changes', () => {
    const state = rosterState();
    const fatigue = state.world.tables.people[0]?.fatigue ?? 0;
    const changed = withFirstFatigue(state, fatigue === 50 ? 51 : 50);
    expect(worldHash(changed)).not.toBe(worldHash(state));
  });

  it('does not change when keys are reordered', () => {
    const state = rosterState();
    const reordered: unknown = reverseKeys(state);
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(state));
    // The copy holds the same data as `state`, only with its keys in another order.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect(worldHash(reordered as EngineState)).toBe(worldHash(state));
  });

  it('does not change when only a timing.ms value changes', () => {
    const state = rosterState();
    const fastRun = { ...state, events: { ...state.events, timing: { ms: 3 } } };
    const slowRun = { ...state, events: { ...state.events, timing: { ms: 4000 } } };
    expect(worldHash(fastRun)).toBe(worldHash(slowRun));
    expect(worldHash(fastRun)).toBe(worldHash(state));
  });

  it('ignores error stacks but not error messages', () => {
    const state = rosterState();
    const withFailure = (message: string, stack: string): EngineState => ({
      ...state,
      failureLog: {
        version: 1,
        entries: [
          {
            date: state.world.meta.currentDate,
            stepId: 'condition.fatigueRecovery',
            error: { name: 'Error', message, stack },
          },
        ],
      },
    });
    expect(worldHash(withFailure('boom', 'at one place'))).toBe(
      worldHash(withFailure('boom', 'at another place')),
    );
    expect(worldHash(withFailure('boom', 'at one place'))).not.toBe(
      worldHash(withFailure('bang', 'at one place')),
    );
  });

  it('matches for two engines run the same number of days from the same state', async () => {
    const start = rosterState();
    const hashes: string[] = [];
    for (let run = 0; run < 2; run++) {
      const engine = createEngine({ state: start, systems: defaultSystems });
      await engine.advanceDays({ maxDays: 10 });
      hashes.push(worldHash(engine.exportState()));
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[0]).not.toBe(worldHash(start));
  });
});
