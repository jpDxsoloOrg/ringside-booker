// The buzz subjects' and the roller's fast paths (POL4-12): a story's subjects get their worldwide
// popularity from the untraced roller, and `rollWorld` gives `rollValues().world`, both to the bit
// and with the trace fields a buzz trace reads. Design: docs/design/day-pipeline.md#fast-paths
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/core/api';
import { defineSystem } from '../../../src/core/api/system';
import { setFastPaths } from '../../../src/core/fastPaths';
import { definePhase } from '../../../src/core/pipeline/phase';
import type { GameWorldView } from '../../../src/model/tables';
import { buzzSubjectsOf, type BuzzSubjects } from '../../../src/systems/news';
import {
  createPopularityRoller,
  type RegionalPopularity,
} from '../../../src/systems/world/formulas/popularityRollup';
import { geographyOf } from '../../../src/systems/world/geography';
import { startDefaultGame } from '../calendar/default-game';

function withFastPaths<T>(on: boolean, run: () => T): T {
  const was = setFastPaths(on);
  try {
    return run();
  } finally {
    setFastPaths(was);
  }
}

/** Runs `probe` once against the default world's first day. */
async function onTheDefaultWorld(probe: (read: GameWorldView) => void): Promise<void> {
  let ran = false;
  const probeSystem = defineSystem({
    id: 'buzzProbe',
    phases: [
      definePhase({
        id: 'buzzProbe.run',
        group: 'housekeeping',
        order: 10,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          if (!ran) {
            ran = true;
            probe(ctx.read);
          }
        },
      }),
    ],
  });
  const engine = createEngine({ state: startDefaultGame(), systems: [probeSystem] });
  const advanced = await engine.advanceDays({ maxDays: 1 });
  expect(advanced.failures).toEqual([]);
  expect(ran).toBe(true);
}

/** What a buzz trace reads of a subject: its value and the root label and doc link. */
function asRead(subjects: BuzzSubjects) {
  return {
    skipped: subjects.skipped,
    subjects: subjects.subjects.map((subject) => ({
      label: subject.label,
      ref: subject.ref,
      value: subject.popularity.value,
      rootLabel: subject.popularity.trace.label,
      rootDocRef: subject.popularity.trace.docRef,
    })),
  };
}

describe('the buzz subjects fast path', () => {
  it('gives every person and promotion the full roll-up world value and root', async () => {
    await onTheDefaultWorld((read) => {
      const geography = geographyOf(read);
      const refs = {
        personIds: [...read.tables.people.ids()],
        promotionIds: [...read.tables.promotions.ids()],
      };
      const full = withFastPaths(false, () => buzzSubjectsOf(read, refs, geography));
      const fast = withFastPaths(true, () => buzzSubjectsOf(read, refs, geography));
      expect(fast.subjects.length).toBe(refs.personIds.length + refs.promotionIds.length);
      expect(asRead(fast)).toEqual(asRead(full));
      for (const [index, subject] of fast.subjects.entries()) {
        expect(Object.is(subject.popularity.value, full.subjects[index]?.popularity.value)).toBe(
          true,
        );
      }
    });
  });
});

describe('PopularityRoller.rollWorld', () => {
  it('gives rollValues().world to the bit, cached or not', async () => {
    await onTheDefaultWorld((read) => {
      const roller = createPopularityRoller(geographyOf(read));
      const maps: RegionalPopularity[] = [
        ...read.tables.people.values().map((person) => person.regionalPop),
        ...read.tables.promotions.values().map((promotion) => promotion.regionalPop),
        {},
      ];
      for (const map of maps) {
        const world = roller.rollValues(map).world;
        expect(
          Object.is(
            withFastPaths(true, () => roller.rollWorld(map)),
            world,
          ),
        ).toBe(true);
        expect(
          Object.is(
            withFastPaths(true, () => roller.rollWorld(map)),
            world,
          ),
        ).toBe(true);
        expect(
          Object.is(
            withFastPaths(false, () => roller.rollWorld(map)),
            world,
          ),
        ).toBe(true);
      }
    });
  });
});
