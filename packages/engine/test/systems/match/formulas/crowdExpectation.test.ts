// Crowd expectation (D-02). Design: docs/design/match-rating.md#crowd-and-expectation-d-02
import { describe, expect, it } from 'vitest';
import { findTraceNodes, untraced, type Traced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { EVENT_IMPORTANCES } from '../../../../src/model/entities/event-definition';
import {
  NOT_TELEVISED_LABEL,
  SLOT_ROLES,
  SLOT_ROLE_LABELS,
  crowdExpectation,
  starPower,
  type CrowdExpectationInputs,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectTraceContains, expectTraceReplays } from '../../../support/trace';

const TUNABLES = createEngineTunables();

function expect80s(): Traced<number> {
  return starPower(
    {
      regionName: 'Great Lakes',
      members: [
        { id: 'a', name: 'Kade Morrow', popularity: 80 },
        { id: 'b', name: 'Rex Vallor', popularity: 80 },
      ],
    },
    { tunables: TUNABLES },
  );
}

function expected(
  partial: Partial<CrowdExpectationInputs> = {},
  overrides: TunableOverrides = {},
): Traced<number> {
  const result = crowdExpectation(
    {
      starPower: untraced(50, 'Star power'),
      momentum: 0,
      role: 'midcard',
      roleLabel: 'Midcard',
      importance: 'regular',
      televised: true,
      ...partial,
    },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  return result;
}

/** The six term lines: every direct add step of the root. */
function termLines(result: Traced<number>): string[] {
  return (result.trace.children ?? [])
    .filter((node) => node.kind === 'add')
    .map((node) => node.label);
}

describe('crowdExpectation', () => {
  it('adds base, star power, momentum, slot, event size and TV, one line each', () => {
    const result = expected({ starPower: untraced(60, 'Star power'), momentum: 40 });
    // 25 + 30 + 4 + 0 + 0 + 2
    expect(result.value).toBeCloseTo(61, 9);
    expect(termLines(result)).toEqual([
      'Base expectation +25',
      'Star power 60 × 0.5',
      'Momentum +40 × 0.1',
      'Card position: Midcard +0',
      'Event size: Regular +0',
      'On TV +2',
    ]);
  });

  it('says "Not on TV +0" for an untelevised show', () => {
    const result = expected({ televised: false });
    expect(result.value).toBeCloseTo(50, 9);
    expect(termLines(result)).toContain(NOT_TELEVISED_LABEL);
    expect(termLines(result)).toHaveLength(6);
  });

  it.each(SLOT_ROLES.map((role) => [role]))('has one card position line for %s', (role) => {
    const result = expected({ role, roleLabel: SLOT_ROLE_LABELS[role] });
    expect(termLines(result).filter((line) => line.startsWith('Card position:'))).toHaveLength(1);
    expect(termLines(result)).toHaveLength(6);
  });

  it.each(EVENT_IMPORTANCES.map((importance) => [importance]))(
    'has one event size line for %s',
    (importance) => {
      const result = expected({ importance });
      expect(termLines(result).filter((line) => line.startsWith('Event size:'))).toHaveLength(1);
    },
  );

  it('reads the slot and event size offsets', () => {
    expectTraceContains(expected({ role: 'mainEvent', roleLabel: 'Main event' }), {
      kind: 'add',
      label: 'Card position: Main event +8',
    });
    expectTraceContains(expected({ importance: 'major' }), {
      kind: 'add',
      label: 'Event size: Major +4',
    });
    expectTraceContains(expected({ importance: 'house' }), {
      kind: 'add',
      label: 'Event size: House show −6',
    });
  });

  it('clamps at 0 and 100', () => {
    const low = expected(
      {
        starPower: untraced(0, 'Star power'),
        momentum: -100,
        role: 'preShow',
        roleLabel: 'Pre-show',
        importance: 'house',
        televised: false,
      },
      { 'match.expectation.base': 0 },
    );
    expect(low.value).toBe(0);
    expect(findTraceNodes(low.trace, 'clamp')[0]?.applied).toBe(true);

    const high = expected(
      {
        starPower: untraced(100, 'Star power'),
        momentum: 100,
        role: 'mainEvent',
        roleLabel: 'Main event',
        importance: 'flagship',
      },
      { 'match.expectation.base': 100 },
    );
    expect(high.value).toBe(100);
  });

  it('expects 11 points more of the same two stars in the main event than as the opener (D-02)', () => {
    const power = expect80s();
    expect(power.value).toBeCloseTo(92.8, 9);
    const opener = expected({ starPower: power, role: 'opener', roleLabel: 'Opener' });
    const mainEvent = expected({ starPower: power, role: 'mainEvent', roleLabel: 'Main event' });
    expect(opener.value).toBeCloseTo(70.4, 9);
    expect(mainEvent.value).toBeCloseTo(81.4, 9);
    expect(mainEvent.value - opener.value).toBeCloseTo(11, 9);
  });

  it('is all zeros with every term at 0', () => {
    const result = expected(
      { starPower: untraced(0, 'Star power'), televised: false },
      { 'match.expectation.base': 0 },
    );
    expect(result.value).toBe(0);
    expect(Number.isNaN(result.value)).toBe(false);
  });
});
