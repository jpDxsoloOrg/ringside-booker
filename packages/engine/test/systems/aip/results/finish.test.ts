// How a rival match ends with MTCH2's finishes (AIP5-06). Design:
// docs/design/rival-booking.md#how-a-rival-shows-results-are-decided
import { describe, expect, it } from 'vitest';
import type { ContentKey } from '../../../../src/core/content-key';
import { RngRegistry } from '../../../../src/core/rng/registry';
import type { RngStream } from '../../../../src/core/rng/registry';
import type { FinishEntry } from '../../../../src/model/catalogs';
import type { GameWorld } from '../../../../src/model/tables';
import {
  hasFinishes,
  leanFinishTrace,
  pickRivalFinish,
  WINNERS_STREAM,
  type RivalFinishArgs,
} from '../../../../src/systems/aip';
import { registerFinishFilter } from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { worldBuilder } from '../../../support/world-builder';

const SEEDS = 300;

function catalogWorld(): GameWorld {
  return worldBuilder().withGeography('mini').withCatalogs().build().world;
}

const world = catalogWorld();
const { catalogs } = world.meta;

/** A two-sided match type every finish admits. */
function singlesKey(): ContentKey {
  const singles = Object.values(catalogs.matchTypes ?? {}).find(
    (matchType) => matchType.sides.min === 2,
  );
  if (singles === undefined) {
    throw new Error('the test catalogs have no two-sided match type');
  }
  return singles.key;
}

function args(overrides: Partial<RivalFinishArgs> = {}): RivalFinishArgs {
  return {
    matchTypeKey: singlesKey(),
    sideCount: 2,
    stipulationKeys: [],
    outcomeKind: 'win',
    winnerAlignment: 'face',
    titleChange: false,
    forceNoChange: false,
    ...overrides,
  };
}

function pick(
  overrides: Partial<RivalFinishArgs>,
  seed: number,
): ReturnType<typeof pickRivalFinish> {
  return pickRivalFinish(world, args(overrides), {
    tunables: createEngineTunables(),
    rng: new RngRegistry(`finish-${String(seed)}`).stream(WINNERS_STREAM),
  });
}

function finishOf(key: ContentKey | undefined): FinishEntry | undefined {
  return key === undefined ? undefined : catalogs.finishes?.[key];
}

/** Whether this finish and method would move a title (MTCH2's title rule). */
function moves(finishKey: ContentKey, methodKey: ContentKey | null): boolean {
  const finish = catalogs.finishes?.[finishKey];
  const method = methodKey === null ? undefined : catalogs.methods?.[methodKey];
  return finish?.allowsTitleChange === true && method?.changesTitles === true;
}

describe('pickRivalFinish', () => {
  it('is used only when the save has finishes', () => {
    expect(hasFinishes(world)).toBe(true);
    const bare = worldBuilder().withGeography('mini').build().world;
    expect(hasFinishes(bare)).toBe(false);
  });

  it('plans a finish and a method the finish lists, for a plain win', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const result = pick({}, seed);
      expect(result).not.toBeNull();
      if (result === null) continue;
      const finish = catalogs.finishes?.[result.finishKey];
      expect(finish?.outcomeKind).toBe('win');
      expect(finish?.methods.map((entry) => entry.methodKey)).toContain(result.methodKey);
      seen.add(result.finishKey);
    }
    // Count-outs and disqualifications happen too, just rarely.
    expect(seen.size).toBeGreaterThan(3);
  });

  it('keeps a planned title change to finishes and methods that move titles', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const result = pick({ titleChange: true }, seed);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(moves(result.finishKey, result.methodKey), result.finishKey).toBe(true);
      }
    }
  });

  it("keeps a forced retention to finishes and methods that can't move titles", () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const result = pick({ forceNoChange: true }, seed);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(moves(result.finishKey, result.methodKey), result.finishKey).toBe(false);
      }
    }
  });

  it('plans a draw finish with no method for a draw', () => {
    const result = pick({ outcomeKind: 'draw', winnerAlignment: null }, 1);
    expect(result?.methodKey).toBeNull();
    expect(finishOf(result?.finishKey)?.outcomeKind).toBe('draw');
  });

  it('lets heels cheat more often than faces', () => {
    const cheating = (alignment: 'face' | 'heel'): number => {
      let count = 0;
      for (let seed = 0; seed < SEEDS; seed++) {
        const result = pick({ winnerAlignment: alignment }, seed);
        if (finishOf(result?.finishKey)?.category === 'cheating') count += 1;
      }
      return count;
    };
    expect(cheating('heel')).toBeGreaterThan(cheating('face'));
  });

  it('returns null, drawing nothing, when no allowed finish fits the plan', () => {
    const remove = registerFinishFilter({
      id: 'test.noTitleFinishes',
      order: 0,
      filter: (entries) => entries.filter((entry) => !entry.allowsTitleChange),
    });
    try {
      let draws = 0;
      const inner = new RngRegistry('none-fit').stream(WINNERS_STREAM);
      const rng: RngStream = {
        name: inner.name,
        nextUint32: () => {
          draws += 1;
          return inner.nextUint32();
        },
        nextFloat: () => {
          draws += 1;
          return inner.nextFloat();
        },
      };
      const result = pickRivalFinish(world, args({ titleChange: true }), {
        tunables: createEngineTunables(),
        rng,
      });
      expect(result).toBeNull();
      expect(draws).toBe(0);
    } finally {
      remove();
    }
  });

  it('stores the finish as its options and roll, without each weight worked out', () => {
    const result = pick({ winnerAlignment: 'heel' }, 3);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.finish.trace.children?.some((child) => child.kind === 'formula')).toBe(true);
    const lean = leanFinishTrace(result.finish);
    expect(lean.children?.some((child) => child.kind === 'formula')).toBe(false);
    expect(lean.children?.some((child) => child.kind === 'roll')).toBe(true);
    expect(lean.kind === 'decision' && lean.considered.length).toBeGreaterThan(1);
  });
});
