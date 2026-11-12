// resolveMatchOutcome: a booking plan to a complete outcome, finish and method (MTCH2-03).
// Design: docs/design/match-finishes.md#resolving-a-match
import { describe, expect, it } from 'vitest';
import { parseContentKey, type ContentKey } from '../../../src/core/content-key';
import { RngRegistry } from '../../../src/core/rng/registry';
import { TRACE_MAX_DEPTH, traceDepth } from '../../../src/core/trace';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import {
  MATCH_RESULT_LABEL,
  MatchResolutionSchema,
  RANDOM_WINNERS_LABEL,
  RANDOM_WINNERS_MESSAGE,
  resolveMatchOutcome,
  type AutoWinnerCompetitor,
  type AutoWinnerMode,
  type AutoWinnerSide,
  type MatchPlan,
  type MatchResolution,
  type ResolveMatchOutcomeResult,
} from '../../../src/systems/match';
import { createEngineTunables } from '../../../src/systems/tunables';
import { TEST_CATALOGS } from '../../support/catalogs';
import { personId } from '../../support/show-world';
import { expectSerialisable } from '../../support/trace';

const SINGLES = parseContentKey('match.singles');
const TRIPLE_THREAT = parseContentKey('match.triple-threat');
const key = (text: string): ContentKey => parseContentKey(text);

function competitor(
  serial: number,
  overrides: Partial<AutoWinnerCompetitor> = {},
): AutoWinnerCompetitor {
  return {
    personId: personId(serial),
    name: `Worker ${String(serial)}`,
    popularityInRegion: 50,
    push: 'midCard',
    momentum: 0,
    alignment: 'face',
    ...overrides,
  };
}

function sideOf(side: number, competitors: readonly AutoWinnerCompetitor[]): AutoWinnerSide {
  return { side, sideLabel: `Side ${String(side + 1)}`, competitors };
}

const TWO_SIDES: readonly AutoWinnerSide[] = [
  sideOf(0, [competitor(1)]),
  sideOf(1, [competitor(2, { popularityInRegion: 70 })]),
];

const THREE_SIDES: readonly AutoWinnerSide[] = [
  ...TWO_SIDES,
  sideOf(2, [competitor(3, { popularityInRegion: 20 })]),
];

function resolve(
  plan: Partial<MatchPlan>,
  options: {
    sides?: readonly AutoWinnerSide[];
    matchTypeKey?: ContentKey;
    mode?: AutoWinnerMode;
    seed?: string;
    overrides?: TunableOverrides;
  } = {},
): ResolveMatchOutcomeResult {
  const registry = new RngRegistry(options.seed ?? 'resolve-test');
  return resolveMatchOutcome(
    {
      matchTypeKey: options.matchTypeKey ?? SINGLES,
      stipulationKeys: [],
      sides: options.sides ?? TWO_SIDES,
      regionName: 'Great Lakes',
      plan: { winner: 'auto', finishKey: null, methodKey: null, ...plan },
      mode: options.mode ?? 'standard',
    },
    {
      catalogs: TEST_CATALOGS,
      tunables: createEngineTunables(options.overrides),
      rng: (name) => registry.stream(name),
    },
  );
}

function resolved(result: ResolveMatchOutcomeResult): MatchResolution {
  if (!result.ok) {
    expect.fail(`resolveMatchOutcome refused: ${JSON.stringify(result.reasons)}`);
  }
  expectSerialisable(result.resolution);
  expect(MatchResolutionSchema.safeParse(result.resolution.value).success).toBe(true);
  expect(result.resolution.trace.label).toBe(MATCH_RESULT_LABEL);
  expect(result.resolution.trace.children).toHaveLength(3);
  expect(traceDepth(result.resolution.trace)).toBeLessThanOrEqual(TRACE_MAX_DEPTH);
  return result.resolution.value;
}

function refusedCodes(result: ResolveMatchOutcomeResult): string[] {
  if (result.ok) {
    expect.fail(`resolveMatchOutcome resolved: ${JSON.stringify(result.resolution.value)}`);
  }
  return result.reasons.map((reason) => reason.code);
}

function finishOutcomeKind(finishKey: ContentKey): string | undefined {
  return TEST_CATALOGS.finishes?.[finishKey]?.outcomeKind;
}

describe('resolveMatchOutcome', () => {
  it('gives Side 2 with an Auto finish a win finish and a method', () => {
    const resolution = resolved(resolve({ winner: { side: 1 } }));
    expect(resolution.outcome).toMatchObject({ kind: 'win', winningSide: 1 });
    expect(finishOutcomeKind(resolution.finishKey)).toBe('win');
    expect(resolution.methodKey).not.toBeNull();
    const finish = TEST_CATALOGS.finishes?.[resolution.finishKey];
    expect(finish?.methods.map((method) => method.methodKey)).toContain(resolution.methodKey);
  });

  it('names a finish once when its only method has the same name', () => {
    const result = resolve({ winner: { side: 1 }, finishKey: key('finish.disqualification') });
    resolved(result);
    if (result.ok) {
      const trace = result.resolution.trace;
      expect(trace.kind === 'decision' ? trace.reason : '').toBe('Disqualification');
    }
    // Count-out's method is spelt Count-Out: still said once.
    const countOut = resolve({ winner: { side: 1 }, finishKey: key('finish.count-out') });
    resolved(countOut);
    if (countOut.ok) {
      const trace = countOut.resolution.trace;
      expect(trace.kind === 'decision' ? trace.reason : '').toBe('Count-out');
    }
  });

  it('gives a Draw with an Auto finish a draw finish and no method', () => {
    const resolution = resolved(resolve({ winner: 'draw' }));
    expect(resolution.outcome).toEqual({ kind: 'draw' });
    expect(finishOutcomeKind(resolution.finishKey)).toBe('draw');
    expect(resolution.methodKey).toBeNull();
  });

  it('gives Auto with the no-contest finish a no contest', () => {
    const resolution = resolved(resolve({ finishKey: key('finish.no-contest') }));
    expect(resolution).toEqual({
      outcome: { kind: 'noContest' },
      finishKey: key('finish.no-contest'),
      methodKey: null,
    });
  });

  it('refuses Side 1 with a stalemate', () => {
    expect(
      refusedCodes(resolve({ winner: { side: 0 }, finishKey: key('finish.stalemate') })),
    ).toEqual(['finishOutcomeMismatch']);
  });

  it('refuses a Draw with a win finish', () => {
    expect(refusedCodes(resolve({ winner: 'draw', finishKey: key('finish.clean') }))).toEqual([
      'finishOutcomeMismatch',
    ]);
  });

  it('refuses a disqualification in a three-sided match', () => {
    expect(
      refusedCodes(
        resolve(
          { finishKey: key('finish.disqualification') },
          { sides: THREE_SIDES, matchTypeKey: TRIPLE_THREAT },
        ),
      ),
    ).toEqual(['finishNotAllowed']);
  });

  it('refuses any planned result in Random winners mode', () => {
    for (const plan of [
      { winner: { side: 0 } },
      { winner: 'draw' as const },
      { finishKey: key('finish.clean') },
      { methodKey: key('method.pinfall') },
    ]) {
      const result = resolve(plan, { mode: 'randomWinners' });
      expect(refusedCodes(result)).toContain('randomWinners');
      if (!result.ok) {
        expect(result.reasons.find((reason) => reason.code === 'randomWinners')?.message).toBe(
          RANDOM_WINNERS_MESSAGE,
        );
      }
    }
  });

  it('decides Random winners mode through the auto-winner and says so first', () => {
    const result = resolve({}, { mode: 'randomWinners' });
    resolved(result);
    if (result.ok) {
      expect(result.resolution.trace.children?.[0]?.label).toBe(RANDOM_WINNERS_LABEL);
      expect(result.resolution.value.outcome.kind).toBe('win');
    }
  });

  it('refuses a side the match does not have', () => {
    expect(refusedCodes(resolve({ winner: { side: 4 } }))).toEqual(['unknownSide']);
  });

  it('refuses a planned method the finish does not list', () => {
    expect(
      refusedCodes(
        resolve({ finishKey: key('finish.flash'), methodKey: key('method.submission') }),
      ),
    ).toEqual(['methodNotInFinish']);
    expect(refusedCodes(resolve({ winner: 'draw', methodKey: key('method.pinfall') }))).toEqual([
      'methodNotInFinish',
    ]);
  });

  it('keeps a planned method and narrows an Auto finish to finishes that list it', () => {
    for (let index = 0; index < 50; index += 1) {
      const resolution = resolved(
        resolve({ methodKey: key('method.submission') }, { seed: `method-${String(index)}` }),
      );
      expect(resolution.methodKey).toBe(key('method.submission'));
      const finish = TEST_CATALOGS.finishes?.[resolution.finishKey];
      expect(finish?.methods.map((method) => method.methodKey)).toContain(key('method.submission'));
    }
  });

  it('refuses a Draw on a match type with no draw finish', () => {
    // A three-sided match: the double count-out needs two sides, and the stalemate is filtered out
    // here by giving every draw finish a match-type rule that leaves this type out.
    const catalogs = structuredClone(TEST_CATALOGS);
    for (const finish of Object.values(catalogs.finishes ?? {})) {
      if (finish.outcomeKind === 'draw') {
        finish.matchTypes = { only: [SINGLES] };
      }
    }
    const registry = new RngRegistry('no-draw');
    const result = resolveMatchOutcome(
      {
        matchTypeKey: TRIPLE_THREAT,
        stipulationKeys: [],
        sides: THREE_SIDES,
        regionName: 'Great Lakes',
        plan: { winner: 'draw', finishKey: null, methodKey: null },
        mode: 'standard',
      },
      { catalogs, tunables: createEngineTunables(), rng: (name) => registry.stream(name) },
    );
    expect(refusedCodes(result)).toEqual(['noFinishAvailable']);
  });

  it('is identical for the same seed and picks the more popular side at randomness 0', () => {
    const first = resolve({}, { seed: 'same' });
    expect(resolve({}, { seed: 'same' })).toEqual(first);
    for (let index = 0; index < 20; index += 1) {
      const resolution = resolved(
        resolve(
          {},
          { seed: `fixed-${String(index)}`, overrides: { 'match.autoWinner.randomness': 0 } },
        ),
      );
      expect(resolution.outcome).toMatchObject({ kind: 'win', winningSide: 1 });
    }
  });

  it('never lets a side with nobody competing win', () => {
    const sides = [sideOf(0, []), sideOf(1, [competitor(2, { popularityInRegion: 0 })])];
    for (let index = 0; index < 200; index += 1) {
      const resolution = resolved(
        resolve({}, { sides, mode: 'randomWinners', seed: `empty-${String(index)}` }),
      );
      expect(resolution.outcome).toMatchObject({ kind: 'win', winningSide: 1 });
    }
    expect(refusedCodes(resolve({ winner: { side: 0 } }, { sides }))).toEqual(['unknownSide']);
  });
});
