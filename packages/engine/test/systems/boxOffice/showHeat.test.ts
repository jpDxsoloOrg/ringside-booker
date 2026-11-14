// The card's linked storyline heat in the crowd forecast (EVT6-11).
// Design: docs/design/box-office.md#show-heat
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import { findTraceNodes } from '../../../src/core/trace';
import { forecastAttendance, storylineHeatsOnCard } from '../../../src/systems/boxOffice';
import { createEngineTunables } from '../../../src/systems/tunables';
import { TEST_START_DATE } from '../../support';
import { storylineWorld } from '../storylines/storyline-world';

const DEFAULTS = createEngineTunables();

/** Show One (start date) carries `segments[1]`, Show Two a week later `segments[0]`, the finale. */
function world() {
  const built = storylineWorld();
  const showOne = built.world.tables.eventInstances.require(built.ids.eventInstances[0]!);
  const showTwo = built.world.tables.eventInstances.require(built.ids.eventInstances[1]!);
  return { ...built, showOne, showTwo };
}

describe('storylineHeatsOnCard', () => {
  it("lists the card's linked storylines at their current heat, marking the finale", () => {
    const { world: read, showOne, showTwo, ids } = world();
    expect(storylineHeatsOnCard(read, showOne)).toEqual([
      {
        name: 'Test Hot Feud',
        heat: 85,
        finale: false,
        ref: { kind: 'storyline', id: ids.storylines[1] },
      },
    ]);
    expect(storylineHeatsOnCard(read, showTwo).map((row) => row.finale)).toEqual([true]);
  });

  it('reads the heat walking into the show once a segment of it has moved the story', () => {
    const { world: read, showOne, ids } = world();
    const hot = ids.storylines[1]!;
    const result = read.transact('heat moved tonight', (tx) => {
      tx.update('storylines', hot, {
        heat: 95,
        progress: [
          {
            segmentId: ids.segments[1]!,
            eventInstanceId: showOne.id,
            date: showOne.date,
            heatBefore: 70,
            heatAfter: 95,
            traceId: null,
          },
        ],
      });
    });
    if (!result.ok) throw result.error;
    expect(storylineHeatsOnCard(read, showOne).map((row) => row.heat)).toEqual([70]);
  });

  it('skips a storyline that ended before the show, keeps one that ended that day or later', () => {
    const { world: read, showOne, showTwo, ids } = world();
    const old = ids.storylines[2]!;
    const result = read.transact('link the old feud', (tx) => {
      for (const segmentId of ids.segments) {
        tx.update('segments', segmentId, { storylineIds: [old] });
      }
      tx.update('storylines', ids.storylines[1]!, { finaleSegmentId: null });
    });
    if (!result.ok) throw result.error;
    // Test Old Feud ended three days after Show One and four days before Show Two.
    expect(addDays(TEST_START_DATE, 3) > showOne.date).toBe(true);
    expect(storylineHeatsOnCard(read, showOne).map((row) => row.name)).toEqual(['Test Old Feud']);
    expect(storylineHeatsOnCard(read, showTwo)).toEqual([]);
  });
});

describe('forecastAttendance with show heat', () => {
  it('raises the crowd for a hot card, more for a finale, on its own Why? line', () => {
    const { world: read, showOne, showTwo } = world();
    const one = forecastAttendance(read, DEFAULTS, showOne);
    const two = forecastAttendance(read, DEFAULTS, showTwo);
    // Heat 85: 15% × (85 − 40) / 60 = 11.25%; × 1.5 for the finale = 16.875%.
    expect(one.inputs.showHeat.value).toBeCloseTo(1.1125, 12);
    expect(two.inputs.showHeat.value).toBeCloseTo(1.16875, 12);
    const labels = findTraceNodes(two.expected.trace, 'formula').map((node) => node.label);
    expect(labels).toContain('Show heat');
    expect(JSON.stringify(two.expected.trace)).toContain('Test Hot Feud: heat 85, finale tonight');
  });

  it('gives the same crowd at settlement as on booking day once tonight has moved the heat', () => {
    const { world: read, showOne, ids } = world();
    const booked = forecastAttendance(read, DEFAULTS, showOne).expected.value;
    const result = read.transact('the show ran', (tx) => {
      tx.update('storylines', ids.storylines[1]!, {
        heat: 100,
        progress: [
          {
            segmentId: ids.segments[1]!,
            eventInstanceId: showOne.id,
            date: showOne.date,
            heatBefore: 85,
            heatAfter: 100,
            traceId: null,
          },
        ],
      });
    });
    if (!result.ok) throw result.error;
    expect(forecastAttendance(read, DEFAULTS, showOne).expected.value).toBe(booked);
  });
});
