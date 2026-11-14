// Beat groups derived from participant sides (MTCH5-01): a stored beat stays
// `{ beatKey, personIds }` and its groups come from who is on which side.
// Design: docs/design/angle-rating.md, "Beat groups and sides".
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../../src/core/content-key';
import type { PersonId } from '../../../../src/core/ids';
import { beatOf, type BeatDef } from '../../../../src/model/catalogs';
import {
  assignAngleSides,
  beatGroupsOf,
  toStoredBeat,
} from '../../../../src/systems/match/angles/beatGroups';
import { worldBuilder } from '../../../support';
import { TEST_CATALOGS } from '../../../support/catalogs';
import { testId } from '../../../support/ids';

const READER = worldBuilder().withCatalogs(TEST_CATALOGS).build().world;
const ANN = testId('person', 1);
const BEA = testId('person', 2);
const CAL = testId('person', 3);
const DEV = testId('person', 4);

function catalogBeat(key: string): BeatDef {
  const beat = beatOf(READER, key);
  if (beat === undefined) {
    throw new Error(`no beat ${key}`);
  }
  return beat;
}

function sidesOf(sides: Readonly<Record<string, number>>) {
  return (personId: PersonId) => sides[personId];
}

describe('beatGroupsOf', () => {
  it('puts everyone in group one for a one-group beat, whatever their sides', () => {
    const brawl = parseContentKey('beat.brawl');
    const groups = beatGroupsOf(
      { beatKey: brawl, personIds: [ANN, BEA] },
      catalogBeat('beat.brawl'),
      sidesOf({ [ANN]: 0, [BEA]: 1 }),
    );
    expect(groups).toEqual({ beatKey: brawl, groupOne: [ANN, BEA], groupTwo: [] });
  });

  it("splits a two-group beat by the first person's side", () => {
    const staredown = parseContentKey('beat.staredown');
    const groups = beatGroupsOf(
      { beatKey: staredown, personIds: [BEA, ANN, DEV, CAL] },
      catalogBeat('beat.staredown'),
      sidesOf({ [ANN]: 0, [CAL]: 0, [BEA]: 1, [DEV]: 1 }),
    );
    expect(groups).toEqual({ beatKey: staredown, groupOne: [BEA, DEV], groupTwo: [ANN, CAL] });
  });

  it('round-trips grouped people through the stored beat', () => {
    const grouped = {
      beatKey: parseContentKey('beat.war-of-words'),
      groupOne: [ANN, CAL],
      groupTwo: [BEA],
    };
    const stored = toStoredBeat(grouped);
    expect(stored).toEqual({ beatKey: grouped.beatKey, personIds: [ANN, CAL, BEA] });
    expect(Object.keys(stored).sort()).toEqual(['beatKey', 'personIds']);
    const sides = assignAngleSides([grouped]);
    if (!('sides' in sides)) {
      throw new Error('expected sides');
    }
    expect(beatGroupsOf(stored, catalogBeat('beat.war-of-words'), sidesOf(sides.sides))).toEqual(
      grouped,
    );
  });
});

describe('assignAngleSides', () => {
  it('gives consistent sides for a staredown a/b then a brawl ab', () => {
    const beats = [
      { beatKey: parseContentKey('beat.staredown'), groupOne: [ANN, CAL], groupTwo: [BEA, DEV] },
      { beatKey: parseContentKey('beat.brawl'), groupOne: [ANN, CAL, BEA, DEV], groupTwo: [] },
    ];
    const result = assignAngleSides(beats);
    expect(result).toEqual({ sides: { [ANN]: 0, [CAL]: 0, [BEA]: 1, [DEV]: 1 } });
    if (!('sides' in result)) {
      return;
    }
    for (const beat of beats) {
      expect(
        beatGroupsOf(toStoredBeat(beat), catalogBeat(beat.beatKey), sidesOf(result.sides)),
      ).toEqual(beat);
    }
  });

  it('reports a conflict when two people share a group in one beat and face each other in the next', () => {
    const result = assignAngleSides([
      { groupOne: [ANN, BEA], groupTwo: [CAL] },
      { groupOne: [ANN], groupTwo: [BEA] },
    ]);
    expect(result).toEqual({ conflict: { personA: ANN, personB: BEA, beatIndex: 1 } });
  });

  it('keeps announcement subjects apart when they face each other later', () => {
    const result = assignAngleSides([
      { groupOne: [CAL], groupTwo: [ANN, BEA] },
      { groupOne: [ANN], groupTwo: [BEA] },
    ]);
    expect(result).toEqual({ sides: { [CAL]: 0, [ANN]: 1, [BEA]: 2 } });
  });

  it('ties an empty-second-group beat together only when told it has two groups', () => {
    expect(assignAngleSides([{ groupOne: [ANN, BEA], groupTwo: [] }])).toEqual({
      sides: { [ANN]: 0, [BEA]: 1 },
    });
    expect(assignAngleSides([{ groupOne: [ANN, BEA], groupTwo: [], twoGroups: true }])).toEqual({
      sides: { [ANN]: 0, [BEA]: 0 },
    });
  });
});
