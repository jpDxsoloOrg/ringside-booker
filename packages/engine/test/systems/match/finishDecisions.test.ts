// The finish decided on the night, the method and the title rule (MTCH2-02).
// Design: docs/design/match-finishes.md#finish-on-the-night
import { describe, expect, it } from 'vitest';
import { parseContentKey, type ContentKey } from '../../../src/core/content-key';
import { InvalidArgumentError } from '../../../src/core/errors';
import { RngRegistry, type RngStream } from '../../../src/core/rng/registry';
import { findTraceNodes } from '../../../src/core/trace';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import {
  AUTO_FINISH_RULE,
  BOOKED_METHOD_REASON,
  MATCH_FINISH_STREAM,
  NEVER_PICKED_REASON,
  NO_METHOD_NOTE,
  ONLY_FINISH_NOTE,
  TITLE_CAN_CHANGE_REASON,
  allowedFinishes,
  autoFinish,
  chooseMethod,
  titleCanChange,
  winnerAlignmentOf,
  type AutoFinishCandidate,
  type ReadonlyFinishEntry,
} from '../../../src/systems/match';
import { createEngineTunables } from '../../../src/systems/tunables';
import { TEST_CATALOGS } from '../../support/catalogs';
import { expectRollRecorded, expectSerialisable } from '../../support/trace';

const SINGLES = parseContentKey('match.singles');
const SEEDS = 1000;

function finishStream(seed: string): RngStream {
  return new RngRegistry(seed).stream(MATCH_FINISH_STREAM);
}

function finish(key: string): ReadonlyFinishEntry {
  const entry = TEST_CATALOGS.finishes?.[parseContentKey(key)];
  if (entry === undefined) {
    throw new Error(`no finish ${key}`);
  }
  return entry;
}

function method(key: string): { name: string; changesTitles: boolean } {
  const entry = TEST_CATALOGS.methods?.[parseContentKey(key)];
  if (entry === undefined) {
    throw new Error(`no method ${key}`);
  }
  return entry;
}

const METHOD_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(TEST_CATALOGS.methods ?? {}).map((entry) => [entry.key, entry.name]),
);

/** The singles match's allowed win finishes, as `autoFinish` candidates. */
const WIN_CANDIDATES: readonly AutoFinishCandidate[] = allowedFinishes(TEST_CATALOGS, {
  matchTypeKey: SINGLES,
}).filter((entry) => entry.outcomeKind === 'win');

const CATEGORY_BY_KEY = new Map(WIN_CANDIDATES.map((entry) => [entry.key, entry.category]));

function pick(
  seed: string,
  options: {
    candidates?: readonly AutoFinishCandidate[];
    winnerAlignment?: 'face' | 'heel' | 'tweener' | null;
    overrides?: TunableOverrides;
  } = {},
) {
  return autoFinish(
    {
      candidates: options.candidates ?? WIN_CANDIDATES,
      winnerAlignment: options.winnerAlignment === undefined ? 'face' : options.winnerAlignment,
    },
    { tunables: createEngineTunables(options.overrides), rng: finishStream(seed) },
  );
}

function cheatingShare(
  winnerAlignment: 'face' | 'heel',
  overrides: TunableOverrides,
): { cheating: number; total: number } {
  let cheating = 0;
  for (let index = 0; index < SEEDS; index += 1) {
    const result = pick(`seed-${String(index)}`, { winnerAlignment, overrides });
    if (CATEGORY_BY_KEY.get(result.value) === 'cheating') {
      cheating += 1;
    }
  }
  return { cheating, total: SEEDS };
}

describe('autoFinish', () => {
  it('is identical for the same seed and replays the same pick', () => {
    const first = pick('same-seed');
    const second = pick('same-seed');
    expect(second).toEqual(first);
    expectSerialisable(first);
    expect(first.trace.kind).toBe('decision');
    const rule = findTraceNodes(first.trace, 'branch')[0];
    expect(rule?.label).toBe(AUTO_FINISH_RULE);
    const roll = expectRollRecorded(first, MATCH_FINISH_STREAM);
    expect(roll.kind).toBe('weighted');
    expect(roll.label).toBe('Finish');
  });

  it('only ever picks a candidate it was given', () => {
    const allowed = new Set(WIN_CANDIDATES.map((entry) => entry.key));
    for (let index = 0; index < 200; index += 1) {
      expect(allowed.has(pick(`allowed-${String(index)}`).value)).toBe(true);
    }
  });

  it('lets cheating finishes dominate for a heel winner at factor 10', () => {
    const { cheating, total } = cheatingShare('heel', {
      'match.autoFinish.heelCheatingFactor': 10,
    });
    expect(cheating).toBeGreaterThan(total / 2);
    const faces = cheatingShare('face', { 'match.autoFinish.heelCheatingFactor': 10 });
    expect(faces.cheating).toBeLessThan(total / 4);
  });

  it('never gives a heel winner a cheating finish at factor 0', () => {
    const { cheating } = cheatingShare('heel', { 'match.autoFinish.heelCheatingFactor': 0 });
    expect(cheating).toBe(0);
    const result = pick('zero-factor', {
      winnerAlignment: 'heel',
      overrides: { 'match.autoFinish.heelCheatingFactor': 0 },
    });
    const considered = result.trace.kind === 'decision' ? result.trace.considered : [];
    const cheatingKey = parseContentKey('finish.cheating');
    expect(considered.find((entry) => entry.option === cheatingKey)).toMatchObject({
      score: 0,
      reason: NEVER_PICKED_REASON,
    });
  });

  it('uses a single candidate without a roll', () => {
    const only = WIN_CANDIDATES[0];
    if (only === undefined) {
      throw new Error('no candidates');
    }
    const result = pick('single', { candidates: [only] });
    expect(result.value).toBe(only.key);
    expect(findTraceNodes(result.trace, 'roll')).toHaveLength(0);
    expect(findTraceNodes(result.trace, 'note').map((node) => node.label)).toContain(
      ONLY_FINISH_NOTE,
    );
  });

  it('refuses an empty candidate list', () => {
    expect(() => pick('empty', { candidates: [] })).toThrow(InvalidArgumentError);
  });
});

describe('winnerAlignmentOf', () => {
  it('takes the majority, gives tweener on a tie and null with nobody employed', () => {
    expect(winnerAlignmentOf(['heel'])).toBe('heel');
    expect(winnerAlignmentOf(['heel', 'heel', 'face'])).toBe('heel');
    expect(winnerAlignmentOf(['heel', 'face'])).toBe('tweener');
    expect(winnerAlignmentOf(['face', null, null])).toBe('face');
    expect(winnerAlignmentOf([null])).toBeNull();
    expect(winnerAlignmentOf([])).toBeNull();
  });
});

describe('chooseMethod', () => {
  const choose = (finishKey: string, planned: string | null, seed = 'method') =>
    chooseMethod(
      {
        finish: finish(finishKey),
        plannedMethodKey: planned === null ? null : parseContentKey(planned),
        methodNames: METHOD_NAMES,
      },
      { rng: finishStream(seed) },
    );

  it('keeps a booked method the finish lists', () => {
    const result = choose('finish.clean', 'method.submission');
    expect(result.value).toBe('method.submission');
    expect(result.trace.kind === 'decision' ? result.trace.reason : null).toBe(
      BOOKED_METHOD_REASON,
    );
    expect(findTraceNodes(result.trace, 'roll')).toHaveLength(0);
  });

  it('gives null for a draw and a no contest', () => {
    for (const key of ['finish.stalemate', 'finish.no-contest']) {
      const result = choose(key, null);
      expect(result.value).toBeNull();
      expect(findTraceNodes(result.trace, 'note').map((node) => node.label)).toContain(
        NO_METHOD_NOTE,
      );
      expectSerialisable(result);
    }
  });

  it('uses a single method without a roll', () => {
    const result = choose('finish.disqualification', null);
    expect(result.value).toBe('method.disqualification');
    expect(findTraceNodes(result.trace, 'roll')).toHaveLength(0);
  });

  it('rolls over several methods by weight, the same for the same seed', () => {
    const first = choose('finish.clean', null, 'rolled');
    expect(choose('finish.clean', null, 'rolled')).toEqual(first);
    const roll = expectRollRecorded(first, MATCH_FINISH_STREAM);
    expect(roll.label).toBe('Method');
    const listed = new Set<ContentKey | null>(
      finish('finish.clean').methods.map((entry) => entry.methodKey),
    );
    expect(listed.has(first.value)).toBe(true);
  });

  it('throws on a booked method the finish does not list', () => {
    expect(() => choose('finish.disqualification', 'method.pinfall')).toThrow(InvalidArgumentError);
  });
});

describe('titleCanChange', () => {
  it.each([
    ['finish.clean', 'method.pinfall', true],
    ['finish.disqualification', 'method.disqualification', false],
    ['finish.count-out', 'method.count-out', false],
    ['finish.stalemate', null, false],
    ['finish.no-contest', null, false],
  ] as const)('%s by %s → %s', (finishKey, methodKey, expected) => {
    const result = titleCanChange({
      finish: finish(finishKey),
      method: methodKey === null ? null : method(methodKey),
    });
    expect(result.value).toBe(expected);
    expect(findTraceNodes(result.trace, 'branch')).toHaveLength(2);
    expectSerialisable(result);
  });

  it('says why a disqualification keeps the title', () => {
    const result = titleCanChange({
      finish: finish('finish.disqualification'),
      method: method('method.disqualification'),
    });
    expect(result.trace.kind === 'decision' ? result.trace.reason : null).toBe(
      "Disqualification: titles can't change hands on this finish",
    );
  });

  it('is false for a clean finish by a method that cannot change titles', () => {
    const result = titleCanChange({
      finish: finish('finish.clean'),
      method: { name: 'Exhibition count', changesTitles: false },
    });
    expect(result.value).toBe(false);
    expect(result.trace.kind === 'decision' ? result.trace.reason : null).toBe(
      "Exhibition count: titles can't change hands by this method",
    );
  });

  it('gives the both-pass reason when the title can change', () => {
    const result = titleCanChange({
      finish: finish('finish.clean'),
      method: method('method.pinfall'),
    });
    expect(result.trace.kind === 'decision' ? result.trace.reason : null).toBe(
      TITLE_CAN_CHANGE_REASON,
    );
  });
});
