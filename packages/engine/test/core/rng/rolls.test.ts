import './testStreams';
import { describe, expect, it } from 'vitest';
import {
  RngRegistry,
  chance,
  floatBetween,
  intBetween,
  normal,
  oneIn,
  pick,
  rollChance,
  rollFloat,
  rollInt,
  rollNormal,
  rollOneIn,
  rollPick,
  rollWeighted,
  weightedPick,
  type RngStream,
  type RollRecord,
} from '@ringside/engine';

const SEED = 'rb-rolls';

function twinStreams(): [RngStream, RngStream] {
  return [new RngRegistry(SEED).stream('test.beta'), new RngRegistry(SEED).stream('test.beta')];
}

function jsonRoundTrip(roll: RollRecord): unknown {
  return JSON.parse(JSON.stringify(roll));
}

const WRESTLERS = ['Ace', 'Brawler', 'Cruiser', 'Daredevil', 'Enforcer'];
const FINISHES = [
  { item: 'pinfall', weight: 6 },
  { item: 'submission', weight: 3 },
  { item: 'count-out', weight: 0 },
  { item: 'disqualification', weight: 1 },
];

describe('rollChance', () => {
  it('records the odds, the boolean result, the stream name and the label', () => {
    const [recorded, plain] = twinStreams();
    const { value, roll } = rollChance(recorded, 0.25, 'Injury check');
    expect(value).toBe(chance(plain, 0.25));
    expect(roll).toEqual({
      stream: 'test.beta',
      kind: 'chance',
      label: 'Injury check',
      odds: 0.25,
      result: value,
    });
    expect(jsonRoundTrip(roll)).toEqual(roll);
  });
});

describe('recorded helpers match the plain helpers draw for draw', () => {
  it('rollChance', () => {
    const [recorded, plain] = twinStreams();
    for (let draw = 0; draw < 1_000; draw++) {
      expect(rollChance(recorded, 0.3, 'check').value).toBe(chance(plain, 0.3));
    }
    expect(recorded.nextUint32()).toBe(plain.nextUint32());
  });

  it('rollInt', () => {
    const [recorded, plain] = twinStreams();
    for (let draw = 0; draw < 1_000; draw++) {
      expect(rollInt(recorded, 1, 6, 'die').value).toBe(intBetween(plain, 1, 6));
    }
    expect(recorded.nextUint32()).toBe(plain.nextUint32());
  });

  it('rollOneIn', () => {
    const [recorded, plain] = twinStreams();
    for (let draw = 0; draw < 1_000; draw++) {
      expect(rollOneIn(recorded, 7, 'rare').value).toBe(oneIn(plain, 7));
    }
    expect(recorded.nextUint32()).toBe(plain.nextUint32());
  });

  it('rollFloat', () => {
    const [recorded, plain] = twinStreams();
    for (let draw = 0; draw < 1_000; draw++) {
      expect(rollFloat(recorded, -1, 1, 'swing').value).toBe(floatBetween(plain, -1, 1));
    }
    expect(recorded.nextUint32()).toBe(plain.nextUint32());
  });

  it('rollNormal', () => {
    const [recorded, plain] = twinStreams();
    for (let draw = 0; draw < 1_000; draw++) {
      expect(rollNormal(recorded, 50, 10, 'attribute').value).toBe(normal(plain, 50, 10));
    }
    expect(recorded.nextUint32()).toBe(plain.nextUint32());
  });

  it('rollPick', () => {
    const [recorded, plain] = twinStreams();
    for (let draw = 0; draw < 1_000; draw++) {
      expect(rollPick(recorded, WRESTLERS, 'opponent', (name) => name).value).toBe(
        pick(plain, WRESTLERS),
      );
    }
    expect(recorded.nextUint32()).toBe(plain.nextUint32());
  });

  it('rollWeighted', () => {
    const [recorded, plain] = twinStreams();
    for (let draw = 0; draw < 1_000; draw++) {
      expect(rollWeighted(recorded, FINISHES, 'finish', (finish) => finish).value).toBe(
        weightedPick(plain, FINISHES),
      );
    }
    expect(recorded.nextUint32()).toBe(plain.nextUint32());
  });
});

describe('roll records', () => {
  it('rollInt records both ends and the odds of one value', () => {
    const [stream] = twinStreams();
    const { value, roll } = rollInt(stream, 1, 4, 'Spot count');
    expect(roll).toEqual({
      stream: 'test.beta',
      kind: 'int',
      label: 'Spot count',
      odds: 0.25,
      min: 1,
      max: 4,
      result: value,
    });
    expect(jsonRoundTrip(roll)).toEqual(roll);
  });

  it('rollOneIn records n as the options and 1 / n as the odds', () => {
    const [stream] = twinStreams();
    const { value, roll } = rollOneIn(stream, 8, 'Botch');
    expect(roll).toEqual({
      stream: 'test.beta',
      kind: 'oneIn',
      label: 'Botch',
      odds: 0.125,
      options: 8,
      result: value,
    });
    expect(jsonRoundTrip(roll)).toEqual(roll);
  });

  it('rollPick records a description of the item, not the item', () => {
    const [stream] = twinStreams();
    const people = WRESTLERS.map((name, index) => ({ name, rank: index + 1 }));
    const { value, roll } = rollPick(stream, people, 'Surprise entrant', (person) => person.name);
    expect(people).toContain(value);
    expect(roll).toEqual({
      stream: 'test.beta',
      kind: 'pick',
      label: 'Surprise entrant',
      odds: 1 / people.length,
      options: people.length,
      result: value.name,
    });
    expect(jsonRoundTrip(roll)).toEqual(roll);
  });

  it('rollWeighted records the chosen entry weight over the total as its odds', () => {
    const [stream] = twinStreams();
    const { value, roll } = rollWeighted(stream, FINISHES, 'Finish', (finish) =>
      finish.toUpperCase(),
    );
    const chosenWeight = FINISHES.find((entry) => entry.item === value)?.weight ?? 0;
    expect(roll).toEqual({
      stream: 'test.beta',
      kind: 'weighted',
      label: 'Finish',
      odds: chosenWeight / 10,
      options: FINISHES.length,
      result: value.toUpperCase(),
    });
    expect(jsonRoundTrip(roll)).toEqual(roll);
  });

  it('rollFloat and rollNormal records survive a JSON round trip', () => {
    const [stream] = twinStreams();
    const floatRoll = rollFloat(stream, 0, 2, 'Crowd swing').roll;
    expect(floatRoll).toMatchObject({ kind: 'float', min: 0, max: 2 });
    expect(jsonRoundTrip(floatRoll)).toEqual(floatRoll);
    const normalRoll = rollNormal(stream, 60, 8, 'Strength').roll;
    expect(normalRoll).toMatchObject({ kind: 'normal', label: 'Strength' });
    expect(jsonRoundTrip(normalRoll)).toEqual(normalRoll);
  });

  it('recorded helpers validate exactly like the plain helpers', () => {
    const [stream] = twinStreams();
    expect(() => rollChance(stream, 1.2, 'bad')).toThrow(RangeError);
    expect(() => rollInt(stream, 6, 1, 'bad')).toThrow(RangeError);
    expect(() => rollOneIn(stream, 0, 'bad')).toThrow(RangeError);
    expect(() => rollPick(stream, [], 'bad', String)).toThrow(RangeError);
    expect(() => rollWeighted(stream, [{ item: 'a', weight: 0 }], 'bad', String)).toThrow(
      RangeError,
    );
  });
});
