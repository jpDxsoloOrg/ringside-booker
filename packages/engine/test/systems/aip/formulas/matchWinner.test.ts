// Who a rival booker puts over. Design: docs/design/rival-booking.md#winners
import { describe, expect, it } from 'vitest';
import { parseId, type PersonId } from '../../../../src/core/ids';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { findTraceNodes, inputOf, TRACE_MAX_NODES, walkTrace } from '../../../../src/core/trace';
import {
  matchWinner,
  parseWinnerPlan,
  rivalSideValue,
  winnerReasonText,
  WINNERS_STREAM,
  type MatchWinnerInputs,
  type MatchWinnerResult,
  type MatchWinnerSide,
  type MatchWinnerStoryline,
} from '../../../../src/systems/aip';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable } from '../../../support/trace';

function personId(serial: number): PersonId {
  return parseId('person', `per_${String(serial).padStart(10, '0')}`);
}

/** Every rule off except the one a test turns on. */
const QUIET: TunableOverrides = {
  'aip.winner.jitter': 0,
  'aip.winner.drawChance': 0,
  'aip.winner.protect.ace': 0,
  'aip.winner.protect.prospect': 0,
  'aip.winner.squash.chance': 0,
};

function side(
  sideNumber: number,
  value: number,
  extra: Partial<MatchWinnerSide> = {},
): MatchWinnerSide {
  return {
    side: sideNumber,
    label: `Side ${String(sideNumber)}`,
    values: inputOf(`Side ${String(sideNumber)} value`, value),
    pushIndex: 3,
    featured: null,
    featuredName: null,
    lowestPersonId: personId(sideNumber),
    ...extra,
  };
}

function inputs(overrides: Partial<MatchWinnerInputs> = {}): MatchWinnerInputs {
  return {
    segmentLabel: 'Side 0 vs Side 1',
    sides: [side(0, 60), side(1, 50)],
    storylines: [],
    allowDraw: true,
    ...overrides,
  };
}

function run(
  matchInputs: MatchWinnerInputs,
  tuned: TunableOverrides = {},
  seed: string | number = 'winner-seed',
): MatchWinnerResult {
  const result = matchWinner(matchInputs, {
    tunables: createEngineTunables({ ...QUIET, ...tuned }),
    rng: new RngRegistry(String(seed)).stream(WINNERS_STREAM),
  });
  expectSerialisable(result.plan);
  const options = (result.plan.trace.kind === 'decision' ? result.plan.trace.considered : []).map(
    (entry) => entry.option,
  );
  for (const entry of matchInputs.sides) {
    expect(options).toContain(`side:${String(entry.side)}`);
  }
  return result;
}

function rollLabels(result: MatchWinnerResult): string[] {
  return findTraceNodes(result.plan.trace, 'roll').map((node) => node.label);
}

function ruleLines(result: MatchWinnerResult): { label: string; taken: boolean }[] {
  return findTraceNodes(result.plan.trace, 'branch').map((node) => ({
    label: node.label,
    taken: node.taken,
  }));
}

function notes(result: MatchWinnerResult): string[] {
  return findTraceNodes(result.plan.trace, 'note').map((node) => node.label);
}

const finale = (overrides: Partial<MatchWinnerStoryline> = {}): MatchWinnerStoryline => ({
  name: 'Blood Feud',
  isFinale: true,
  finaleReason: '60 days old; finales start at 56',
  faceSide: 1,
  heelSide: 0,
  ...overrides,
});

describe('matchWinner', () => {
  it('opens with one considered entry per side, then picks the higher value', () => {
    const result = run(inputs());
    expect(result.plan.value).toBe('side:0');
    expect(result.reasonKey).toBe('value');
    expect(result.plan.trace.kind === 'decision' && result.plan.trace.considered).toHaveLength(2);
    expect(rollLabels(result)).toEqual([]);
  });

  it('never draws at draw chance 0 and draws no roll, over 10,000 seeds', () => {
    const tunables = createEngineTunables({ 'aip.winner.drawChance': 0 });
    for (let seed = 0; seed < 10_000; seed += 1) {
      const result = matchWinner(inputs(), {
        tunables,
        rng: new RngRegistry(`d${String(seed)}`).stream(WINNERS_STREAM),
      });
      expect(result.plan.value).not.toBe('draw');
      expect(rollLabels(result)).not.toContain('Booked as a draw?');
    }
    expect(notes(run(inputs()))).toContain('Draws are off (0)');
  });

  it('always draws at draw chance 1 with two sides, never with three', () => {
    const two = run(inputs(), { 'aip.winner.drawChance': 1 });
    expect(two.plan.value).toBe('draw');
    expect(two.reasonKey).toBe('draw');
    expect(parseWinnerPlan(two.plan.value)).toEqual({ kind: 'draw' });
    const three = run(inputs({ sides: [side(0, 60), side(1, 50), side(2, 40)] }), {
      'aip.winner.drawChance': 1,
    });
    expect(three.plan.value).toBe('side:0');
    expect(ruleLines(three)).toContainEqual({
      label: 'Draws need exactly two sides',
      taken: false,
    });
  });

  it('does not draw when the match type cannot end in a draw', () => {
    const result = run(inputs({ allowDraw: false }), { 'aip.winner.drawChance': 1 });
    expect(result.plan.value).toBe('side:0');
  });

  it('gives a finale to the faces at face chance 1 and the heels at 0', () => {
    const faces = run(inputs({ storylines: [finale()] }), { 'aip.winner.finale.faceChance': 1 });
    expect(faces.plan.value).toBe('side:1');
    expect(faces.reasonKey).toBe('finale');
    expect(ruleLines(faces)).toContainEqual({
      label: 'Storyline finale: Blood Feud (60 days old; finales start at 56)',
      taken: true,
    });
    const heels = run(inputs({ storylines: [finale({ faceSide: 0, heelSide: 1 })] }), {
      'aip.winner.finale.faceChance': 0,
    });
    expect(heels.plan.value).toBe('side:1');
    expect(heels.plan.trace.kind === 'decision' && heels.plan.trace.reason).toBe(
      'Storyline finale: the heels have the last word',
    );
  });

  it('records a storyline short of its finale as not applying, with its age note', () => {
    const result = run(
      inputs({
        storylines: [finale({ isFinale: false, finaleReason: '23 days old; finales start at 56' })],
      }),
      { 'aip.winner.finale.faceChance': 1 },
    );
    expect(result.reasonKey).toBe('value');
    expect(ruleLines(result)).toContainEqual({ label: 'Storyline finale', taken: false });
    expect(notes(result)).toContain('Blood Feud is 23 days old; finales start at 56');
    expect(notes(run(inputs()))).toContain('No storyline on this match');
  });

  it('picks the finale by name, then id', () => {
    const result = run(
      inputs({
        storylines: [
          finale({ name: 'Zed', faceSide: 0, heelSide: 1 }),
          finale({ name: 'Alpha', storylineId: 'b', faceSide: 1, heelSide: 0 }),
          finale({ name: 'Alpha', storylineId: 'a', faceSide: 0, heelSide: 1 }),
        ],
      }),
      { 'aip.winner.finale.faceChance': 1 },
    );
    expect(result.plan.value).toBe('side:0');
  });

  it('protects a prospect at chance 1, never at 0 and draws no roll then', () => {
    const prospect = inputs({
      sides: [side(0, 60), side(1, 40, { featured: 'prospect', featuredName: 'Kai Moreno' })],
    });
    const kept = run(prospect, { 'aip.winner.protect.prospect': 1 });
    expect(kept.plan.value).toBe('side:1');
    expect(kept.reasonKey).toBe('protected');
    expect(kept.protectedRole).toBe('prospect');
    expect(rollLabels(kept)).toEqual(['Protect Kai Moreno?']);
    expect(winnerReasonText(kept.reasonKey, { protectedRole: kept.protectedRole })).toBe(
      'Protected prospect',
    );
    for (let seed = 0; seed < 200; seed += 1) {
      const off = run(prospect, {}, seed);
      expect(off.plan.value).toBe('side:0');
      expect(rollLabels(off)).toEqual([]);
    }
    expect(notes(run(prospect))).toContain('Protection is off (0)');
  });

  it('has no protection rule when featured workers are on both sides', () => {
    const result = run(
      inputs({
        sides: [
          side(0, 60, { featured: 'ace', featuredName: 'Ace' }),
          side(1, 40, { featured: 'prospect', featuredName: 'Kid' }),
        ],
      }),
      { 'aip.winner.protect.ace': 1, 'aip.winner.protect.prospect': 1 },
    );
    expect(result.reasonKey).toBe('value');
    expect(ruleLines(result)).toContainEqual({
      label: 'Featured workers on both sides: no protection',
      taken: false,
    });
  });

  it('squashes for the top side at chance 1 with gap 3, even with a lower value', () => {
    const result = run(
      inputs({ sides: [side(0, 70, { pushIndex: 1 }), side(1, 40, { pushIndex: 4 })] }),
      { 'aip.winner.squash.chance': 1 },
    );
    expect(result.plan.value).toBe('side:1');
    expect(result.reasonKey).toBe('squash');
    expect(result.plan.trace.kind === 'decision' && result.plan.trace.reason).toBe(
      'Squash: Side 1 is 3 card positions higher',
    );
  });

  it('is no squash at gap 2 with push gap 3', () => {
    const result = run(
      inputs({ sides: [side(0, 70, { pushIndex: 2 }), side(1, 40, { pushIndex: 4 })] }),
      { 'aip.winner.squash.chance': 1, 'aip.winner.squash.pushGap': 3 },
    );
    expect(result.plan.value).toBe('side:0');
    expect(ruleLines(result)).toContainEqual({
      label: 'Squash: card positions 2 apart, needs 3',
      taken: false,
    });
    expect(rollLabels(result)).toEqual([]);
  });

  it('breaks an exact tie by lowest person id when there is no jitter', () => {
    const result = run(
      inputs({
        sides: [
          side(0, 50, { lowestPersonId: personId(9) }),
          side(1, 50, { lowestPersonId: personId(1) }),
        ],
      }),
    );
    expect(result.plan.value).toBe('side:1');
    expect(result.reasonKey).toBe('tieBreak');
    expect(ruleLines(result)).toContainEqual({
      label: 'Tie broken by lowest person id',
      taken: true,
    });
  });

  it('splits equal sides 40-60% each with jitter 0.1 over 2,000 seeds', () => {
    const tunables = createEngineTunables({ ...QUIET, 'aip.winner.jitter': 0.1 });
    let firstWins = 0;
    const seeds = 2000;
    for (let seed = 0; seed < seeds; seed += 1) {
      const rng = new RngRegistry(`j${String(seed)}`).stream(WINNERS_STREAM);
      const sides = [0, 1].map((number) =>
        side(number, 0, {
          values: rivalSideValue(
            { label: `Side ${String(number)}`, cardValues: [inputOf('Card value', 50)] },
            { tunables, rng },
          ),
        }),
      );
      const result = matchWinner(inputs({ sides }), { tunables, rng });
      if (result.plan.value === 'side:0') {
        firstWins += 1;
      }
    }
    expect(firstWins / seeds).toBeGreaterThan(0.4);
    expect(firstWins / seeds).toBeLessThan(0.6);
  });

  it('gives an identical trace for the same seed', () => {
    const busy: TunableOverrides = {
      'aip.winner.drawChance': 0.3,
      'aip.winner.protect.prospect': 0.5,
      'aip.winner.squash.chance': 0.5,
    };
    const matchInputs = inputs({
      sides: [
        side(0, 60, { pushIndex: 5 }),
        side(1, 40, { pushIndex: 1, featured: 'prospect', featuredName: 'Kid' }),
      ],
    });
    expect(run(matchInputs, busy, 'same')).toEqual(run(matchInputs, busy, 'same'));
  });

  it('keeps a 20-side match within the trace budget', () => {
    const tunables = createEngineTunables({ 'aip.winner.jitter': 0.1 });
    const rng = new RngRegistry('royal').stream(WINNERS_STREAM);
    const sides = Array.from({ length: 20 }, (_, number) =>
      side(number, 0, {
        values: rivalSideValue(
          {
            label: `Side ${String(number)}`,
            cardValues: [inputOf('a', 40 + number), inputOf('b', 50), inputOf('c', 60)],
          },
          { tunables, rng },
        ),
      }),
    );
    const result = run(inputs({ sides, allowDraw: false }));
    let count = 0;
    walkTrace(result.plan.trace, () => {
      count += 1;
    });
    expect(count).toBeLessThanOrEqual(TRACE_MAX_NODES);
  });

  it('reads plan keys and names each reason', () => {
    expect(parseWinnerPlan('side:3')).toEqual({ kind: 'win', side: 3 });
    expect(() => parseWinnerPlan('side:x')).toThrow();
    expect(winnerReasonText('squash')).toBe('Squash');
    expect(winnerReasonText('finale')).toBe('Storyline finale');
    expect(winnerReasonText('value')).toBe('Higher value');
    expect(winnerReasonText('draw')).toBe('Draw');
    expect(winnerReasonText('protected', { protectedRole: 'ace' })).toBe('Protected ace');
  });
});
