// rateSegment (MTCH1-05): rating the tiny world's match and promo from plain input, the slot in
// the Why? panel, per-worker lines and the refusals.
// Design: docs/design/match-rating.md#pipeline-and-seams
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../../src/core/content-key';
import { parseGameDate } from '../../../../src/core/date';
import { parseId, type PersonId } from '../../../../src/core/ids';
import {
  findTraceNodes,
  isTruncationNote,
  traceDepth,
  walkTrace,
  type Traced,
} from '../../../../src/core/trace';
import {
  MATCH_RATING_STREAM,
  NOT_UNDER_CONTRACT_NOTE,
  NO_VARIANCE_NOTE,
  durationLabelOf,
  rateSegment,
  slotWeightLine,
  workerPerformance,
  type SegmentRatingInput,
  type SegmentRatingResult,
} from '../../../../src/systems/match';
import { expectRollRecorded, expectSerialisable, expectTraceReplays } from '../../../support/trace';
import {
  DEFAULT_TUNABLES,
  inputOf,
  personAt,
  rate,
  ratingStream,
  setMomentum,
  stepsLabelled,
  tinyRating,
  updatePerson,
} from './fixtures';

/** Every numeric trace the result carries. */
function tracesOf(result: SegmentRatingResult): Traced<number>[] {
  const main = [
    result.score,
    result.stars,
    result.crowd,
    result.expectation,
    result.starPower,
    result.slot.weightTrace,
  ];
  const performance = result.workRate ?? result.talk;
  const workers = result.workers.flatMap((line) =>
    [line.inRing, line.entertainment, line.talk, line.popularity, line.momentum].filter(
      (value): value is Traced<number> => value !== null,
    ),
  );
  return [...main, ...(performance === null ? [] : [performance]), ...workers];
}

function expectWellFormed(result: SegmentRatingResult): void {
  expectSerialisable(result);
  for (const value of tracesOf(result)) {
    expectTraceReplays(value);
    expect(traceDepth(value.trace)).toBeLessThanOrEqual(12);
    let truncated = 0;
    walkTrace(value.trace, (node) => {
      if (isTruncationNote(node)) {
        truncated += 1;
      }
    });
    expect(truncated).toBe(0);
  }
  expect(Number.isInteger(result.score.value)).toBe(true);
  expect(result.score.value).toBeGreaterThanOrEqual(0);
  expect(result.score.value).toBeLessThanOrEqual(100);
  expect(result.stars.value * 4).toBe(Math.round(result.stars.value * 4));
  expect(result.stars.value).toBeGreaterThanOrEqual(0);
  expect(result.stars.value).toBeLessThanOrEqual(5);
  expect(result.crowd.value).toBeGreaterThanOrEqual(0);
  expect(result.crowd.value).toBeLessThanOrEqual(100);
  expect(JSON.stringify(result)).not.toMatch(/minute/i);
}

describe('rateSegment on the tiny world', () => {
  it('rates the title match: plain JSON whose traces replay', () => {
    const { world, mainEvent } = tinyRating();
    const result = rate(world, inputOf(world, mainEvent.id), { rng: ratingStream() });
    expect(result.kind).toBe('match');
    expect(result.workRate).not.toBeNull();
    expect(result.talk).toBeNull();
    expect(result.workers).toHaveLength(2);
    expect(result.workers.every((line) => line.inRing !== null && line.talk === null)).toBe(true);
    expect(result.workers.every((line) => line.stamina !== null)).toBe(true);
    expect(result.warnings).toEqual([]);
    expectWellFormed(result);
  });

  it('rates the promo: talk in place of work rate', () => {
    const { world, promo } = tinyRating();
    const result = rate(world, inputOf(world, promo.id), { rng: ratingStream() });
    expect(result.kind).toBe('angle');
    expect(result.workRate).toBeNull();
    expect(result.talk).not.toBeNull();
    expect(result.workers.every((line) => line.inRing === null && line.talk !== null)).toBe(true);
    expect(result.workers.every((line) => line.stamina === null)).toBe(true);
    expectWellFormed(result);
  });

  it('rates every stored segment of the tiny world', () => {
    const { world } = tinyRating();
    for (const segment of world.tables.segments.values()) {
      expectWellFormed(rate(world, inputOf(world, segment.id)));
    }
  });

  it('shows the slot role, duration class and weight at the top of the score and stars', () => {
    const { world, mainEvent } = tinyRating();
    const input: SegmentRatingInput = {
      ...inputOf(world, mainEvent.id),
      slot: { role: 'mainEvent' },
    };
    const result = rate(world, input);
    expect(result.slot.role).toBe('mainEvent');
    expect(result.slot.durationClass).toBe('long');
    expect(durationLabelOf(result.slot)).toBe('Main event (long)');
    for (const value of [result.score, result.stars]) {
      const labels = (value.trace.children ?? []).slice(1, 3).map((node) => node.label);
      expect(labels).toEqual(['Main event (long)', slotWeightLine(result.slot.weight)]);
    }
    expect(slotWeightLine(1.75)).toBe('Slot weight ×1.75');
  });

  it('derives the role from a slot position', () => {
    const { world, mainEvent } = tinyRating();
    const input: SegmentRatingInput = {
      ...inputOf(world, mainEvent.id),
      slot: { slot: 6, slots: 6, preShow: false },
    };
    expect(rate(world, input).slot.role).toBe('mainEvent');
    const opener = rate(world, { ...input, slot: { slot: 1, slots: 6, preShow: false } });
    expect(opener.slot.role).toBe('opener');
    expect(stepsLabelled(opener.score, 'Opener (standard)')).toHaveLength(1);
  });

  it('rolls on the stream it is given, the same way for the same seed', () => {
    const { world, mainEvent } = tinyRating();
    const input = inputOf(world, mainEvent.id);
    const first = rate(world, input, { rng: ratingStream('same') });
    const second = rate(world, input, { rng: ratingStream('same') });
    expect(second).toEqual(first);
    if (first.workRate === null) {
      throw new Error('a match has a work rate');
    }
    expectRollRecorded(first.workRate, MATCH_RATING_STREAM);
    expectRollRecorded(first.crowd, MATCH_RATING_STREAM);
  });

  it('skips the rolls without a stream and says so', () => {
    const { world, mainEvent } = tinyRating();
    const result = rate(world, inputOf(world, mainEvent.id));
    if (result.workRate === null) {
      throw new Error('a match has a work rate');
    }
    expect(stepsLabelled(result.workRate, NO_VARIANCE_NOTE)).toHaveLength(1);
    expect(stepsLabelled(result.crowd, NO_VARIANCE_NOTE)).toHaveLength(1);
    expect(findTraceNodes(result.workRate.trace, 'roll')).toEqual([]);
  });
});

describe('per-worker lines', () => {
  it("come from each worker's own inputs, whatever the order", () => {
    const { world, mainEvent, people } = tinyRating();
    const star = personAt(people, 0);
    const rookie = personAt(people, 1);
    const input = inputOf(world, mainEvent.id);
    updatePerson(world, star, (person) => ({
      ...person,
      attributes: { ...person.attributes, ringwork: 90, psychology: 85, charisma: 80 },
      fatigue: 10,
      regionalPop: { ...person.regionalPop, [input.event.regionId]: 70 },
    }));
    updatePerson(world, rookie, (person) => ({
      ...person,
      attributes: { ...person.attributes, ringwork: 20, psychology: 30, charisma: 25 },
      fatigue: 60,
    }));
    setMomentum(world, star, 40);

    const result = rate(world, input);
    const lineOf = (personId: PersonId) => {
      const line = result.workers.find((worker) => worker.personId === personId);
      if (line === undefined) {
        throw new Error(`no line for ${personId}`);
      }
      return line;
    };
    for (const personId of [star, rookie]) {
      const person = world.tables.people.require(personId);
      const line = lineOf(personId);
      const own = workerPerformance(
        {
          personId,
          name: line.name,
          axis: 'inRing',
          attributes: person.attributes,
          style: person.style,
          fatigue: person.fatigue,
          injured: false,
          styleAffinity: [],
        },
        { tunables: DEFAULT_TUNABLES },
      );
      expect(line.inRing?.value).toBe(own.value);
      expect(line.stamina?.have).toBe(person.attributes.stamina);
    }
    expect(lineOf(star).popularity.value).toBe(70);
    expect(lineOf(rookie).popularity.value).toBe(0);
    expect(lineOf(star).momentum.value).toBe(40);
    expect(lineOf(star).inRing?.value).not.toBe(lineOf(rookie).inRing?.value);

    // The same people, sides swapped: each line is unchanged.
    const swapped = rate(world, { ...input, sides: [...input.sides].reverse() });
    for (const personId of [star, rookie]) {
      const before = lineOf(personId);
      const after = swapped.workers.find((worker) => worker.personId === personId);
      expect(after?.inRing).toEqual(before.inRing);
      expect(after?.popularity).toEqual(before.popularity);
      expect(after?.momentum).toEqual(before.momentum);
    }
  });

  it("checks each worker's stamina against the slot's need", () => {
    const { world, mainEvent, people } = tinyRating();
    const tired = personAt(people, 1);
    updatePerson(world, tired, (person) => ({
      ...person,
      attributes: { ...person.attributes, stamina: 10 },
    }));
    const result = rate(world, { ...inputOf(world, mainEvent.id), slot: { role: 'mainEvent' } });
    const need = DEFAULT_TUNABLES.get('match.workRate.staminaNeed.long');
    const perPoint = DEFAULT_TUNABLES.get('match.workRate.staminaPenaltyPerPoint');
    for (const line of result.workers) {
      const have = world.tables.people.require(line.personId).attributes.stamina;
      expect(line.stamina?.need).toBe(need);
      expect(line.stamina?.have).toBe(have);
      expect(line.stamina?.penalty.value).toBeCloseTo(Math.max(0, need - have) * perPoint, 9);
    }
    expect(
      result.workers.find((line) => line.personId === tired)?.stamina?.penalty.value,
    ).toBeGreaterThan(0);
  });

  it('gives momentum 0 with "Not under contract here" to someone from another promotion', () => {
    const { world, mainEvent, people } = tinyRating();
    const outsider = personAt(people, 8);
    const input = inputOf(world, mainEvent.id);
    const result = rate(world, {
      ...input,
      sides: [input.sides[0] ?? { side: 0, personIds: [] }, { side: 1, personIds: [outsider] }],
    });
    const line = result.workers.find((worker) => worker.personId === outsider);
    expect(line?.momentum.value).toBe(0);
    expect(line?.momentum.trace).toMatchObject({
      kind: 'constant',
      reason: NOT_UNDER_CONTRACT_NOTE,
    });
  });

  it('charges a worker injured on the show date for working hurt and warns', () => {
    const { world, mainEvent, people } = tinyRating();
    const hurt = personAt(people, 1);
    const input = inputOf(world, mainEvent.id);
    updatePerson(world, hurt, (person) => ({
      ...person,
      injury: {
        kindKey: parseContentKey('injury.sprained-ankle'),
        bodyPart: 'legs',
        since: parseGameDate('2026-04-01'),
        expectedReturn: parseGameDate('2026-04-20'),
        canWorkAngles: true,
      },
    }));
    const result = rate(world, input);
    const line = result.workers.find((worker) => worker.personId === hurt);
    expect(
      findTraceNodes(
        line?.inRing?.trace ?? { kind: 'note', label: '', value: null },
        'subtract',
      ).map((node) => node.label),
    ).toContain('Working hurt');
    expect(result.warnings.map((warning) => warning.code)).toEqual(['injured']);
  });
});

describe('rateSegment refusals', () => {
  function refusalCodes(input: SegmentRatingInput, world = tinyRating().world): string[] {
    const result = rateSegment(input, { read: world, tunables: DEFAULT_TUNABLES });
    expect(result.ok).toBe(false);
    return result.ok ? [] : result.reasons.map((reason) => reason.code);
  }

  const { world, mainEvent, promo } = tinyRating();
  const matchInput = inputOf(world, mainEvent.id);

  it('refuses an unknown type key or kind', () => {
    expect(refusalCodes({ ...matchInput, typeKey: parseContentKey('match.cage') }, world)).toEqual([
      'unknownType',
    ]);
    expect(
      refusalCodes({ ...inputOf(world, promo.id), typeKey: parseContentKey('angle.mime') }, world),
    ).toEqual(['unknownType']);
    const notAKind: SegmentRatingInput = { ...matchInput };
    Reflect.set(notAKind, 'kind', 'dance');
    expect(refusalCodes(notAKind, world)).toEqual(['unknownType']);
  });

  it('refuses no sides or an empty side', () => {
    expect(refusalCodes({ ...matchInput, sides: [] }, world)).toEqual(['emptySide']);
    expect(
      refusalCodes(
        { ...matchInput, sides: [...matchInput.sides, { side: 2, personIds: [] }] },
        world,
      ),
    ).toEqual(['emptySide']);
  });

  it('refuses a person the world does not have', () => {
    const ghost = parseId('person', 'per_9999999999');
    expect(
      refusalCodes(
        { ...matchInput, sides: [...matchInput.sides, { side: 2, personIds: [ghost] }] },
        world,
      ),
    ).toEqual(['unknownPerson']);
  });

  it('refuses a slot off the card, a bad side number or an unknown promotion', () => {
    expect(
      refusalCodes({ ...matchInput, slot: { slot: 7, slots: 6, preShow: false } }, world),
    ).toEqual(['invalidSlot']);
    const twice = matchInput.sides.map((side) => ({ ...side, side: 0 }));
    expect(refusalCodes({ ...matchInput, sides: twice }, world)).toEqual(['invalidSide']);
    expect(
      refusalCodes({ ...matchInput, promotionId: parseId('promotion', 'pro_9999999999') }, world),
    ).toEqual(['unknownPromotion']);
  });

  it('never writes to the world', () => {
    const before = JSON.stringify(world.tables.segments.values());
    rate(world, matchInput, { rng: ratingStream() });
    expect(JSON.stringify(world.tables.segments.values())).toBe(before);
  });
});
