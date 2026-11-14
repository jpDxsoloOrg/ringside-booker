// match.previewAngle (MTCH5-03): an angle built from beats, rated without happening.
// Design: docs/design/angle-rating.md#previewing-an-angle
import { describe, expect, it } from 'vitest';
import { OMNISCIENT_VIEWER } from '../../../../src/core/api';
import { parseContentKey } from '../../../../src/core/content-key';
import { addDays } from '../../../../src/core/date';
import { findTraceNodes, type TraceNode } from '../../../../src/core/trace';
import {
  ANGLE_STREAM,
  NO_BEAT_CATALOG_MESSAGE,
  NOT_YOUR_WORKER_NOTE,
  PREVIEW_ANGLE_REASON_CODES,
  type BeatPersonResult,
  type PreviewAngleResult,
} from '../../../../src/systems/match';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';
import { updatePerson } from '../rating/fixtures';
import {
  angleWorld,
  BRAWL,
  beatArgs,
  CONFRONTATION_TYPE,
  PLAYER,
  previewAngle,
  promoArgs,
  PROMO,
  STAREDOWN,
  updateContract,
  WAR_OF_WORDS,
} from './angle-world';

function firstPerson(result: PreviewAngleResult, beat = 0, group = 0): BeatPersonResult {
  const person = result.beats[beat]?.groups[group]?.people[0];
  if (person === undefined) {
    throw new Error('no person');
  }
  return person;
}

function hasNote(node: TraceNode, label: string): boolean {
  return findTraceNodes(node, 'note').some((note) => note.label === label);
}

describe('match.previewAngle', () => {
  it('rates a midcard promo: score, stars and Mic as the best stat, every trace inline', () => {
    const setup = angleWorld();
    const result = previewAngle(setup, promoArgs(setup));
    expect(Number.isInteger(result.score.value)).toBe(true);
    expect(result.score.value).toBeGreaterThan(0);
    expect(result.stars.value * 4).toBe(Math.round(result.stars.value * 4));
    expect(result.durationClass).toBe('standard');
    expect(result.beatLimit).toEqual({ max: 4, message: 'Standard slot: up to 4 beats' });
    const talker = firstPerson(result);
    expect(talker.stat).toBe('mic');
    expect(talker.statLabel).toBe('Mic');
    expect(talker.viaManager).toBe(false);
    for (const value of [
      result.score,
      result.stars,
      result.delivered,
      result.expected,
      result.crowd,
      talker.value,
    ]) {
      expect(value.trace).toBeDefined();
      expectTraceReplays(value);
    }
    const beatScore = result.beats[0]?.score;
    expect(beatScore?.trace.label).toBe('Beat: Promo');
    expect(result.warnings).toEqual([]);
    expectSerialisable(result);
  });

  it('shows the manager standing in through an override', () => {
    const setup = angleWorld();
    const [, weak] = setup.wrestlers;
    const args = promoArgs(setup, { beats: [beatArgs(PROMO, [weak])] });
    expect(firstPerson(previewAngle(setup, args)).viaManager).toBe(false);
    const result = previewAngle(setup, {
      ...args,
      managerOverrides: { [weak]: setup.manager },
    });
    const talker = firstPerson(result);
    expect(talker.viaManager).toBe(true);
    expect(talker.stat).toBe('mic');
    expect(talker.statLabel).toMatch(/^Mic via manager /);
  });

  it('uses the contract manager unless an override says null', () => {
    const setup = angleWorld();
    const [, weak] = setup.wrestlers;
    updateContract(setup.world, weak, { managerPersonId: setup.manager });
    const args = promoArgs(setup, { beats: [beatArgs(PROMO, [weak])] });
    expect(firstPerson(previewAngle(setup, args)).viaManager).toBe(true);
    const without = previewAngle(setup, { ...args, managerOverrides: { [weak]: null } });
    expect(firstPerson(without).viaManager).toBe(false);
  });

  it('refuses an override that is not a manager', () => {
    const setup = angleWorld();
    const [first, second] = setup.wrestlers;
    const result = setup.engine.query(
      'match.previewAngle',
      promoArgs(setup, { managerOverrides: { [first]: second } }),
      PLAYER,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.map((reason) => reason.code)).toEqual([
        PREVIEW_ANGLE_REASON_CODES.notAManager,
      ]);
    }
  });

  it("reads morale only for the viewer's workers: the all-seeing viewer sees everyone neutral", () => {
    const setup = angleWorld();
    const [first] = setup.wrestlers;
    updateContract(setup.world, first, { morale: -80, momentum: -50 });
    const args = promoArgs(setup, { promotionId: setup.promotion });
    const mine = firstPerson(previewAngle(setup, args));
    expect(hasNote(mine.value.trace, NOT_YOUR_WORKER_NOTE)).toBe(false);
    const omniscient = firstPerson(previewAngle(setup, args, OMNISCIENT_VIEWER));
    expect(hasNote(omniscient.value.trace, NOT_YOUR_WORKER_NOTE)).toBe(true);
    expect(omniscient.value.value).toBeGreaterThan(mine.value.value);
  });

  it("treats a rival's workers as neutral for the player", () => {
    const setup = angleWorld();
    const [rival] = setup.rivals;
    updateContract(setup.world, rival, { morale: -80 });
    const result = previewAngle(
      setup,
      promoArgs(setup, { promotionId: setup.rival, beats: [beatArgs(PROMO, [rival])] }),
    );
    expect(hasNote(firstPerson(result).value.trace, NOT_YOUR_WORKER_NOTE)).toBe(true);
  });

  it('is the same twice with the same seed and never moves the world or its RNG', () => {
    const setup = angleWorld();
    const [first, second] = setup.wrestlers;
    const args = promoArgs(setup, {
      angleTypeKey: CONFRONTATION_TYPE,
      slotRole: 'mainEvent',
      beats: [
        beatArgs(STAREDOWN, [first], [second]),
        beatArgs(WAR_OF_WORDS, [first], [second]),
        beatArgs(BRAWL, [first, second]),
      ],
    });
    const before = JSON.stringify(setup.engine.exportState());
    const once = previewAngle(setup, args);
    const twice = previewAngle(setup, args);
    expect(twice).toEqual(once);
    const after = setup.engine.exportState();
    expect(after.rng.streams).not.toHaveProperty(ANGLE_STREAM);
    expect(JSON.stringify(after)).toBe(before);
    const other = previewAngle(setup, { ...args, previewSeed: 8 });
    expect(other.beats.map((beat) => beat.score?.value)).not.toEqual(
      once.beats.map((beat) => beat.score?.value),
    );
  });

  it('refuses unknown and disallowed beats and an empty required group', () => {
    const setup = angleWorld();
    const [first] = setup.wrestlers;
    const result = setup.engine.query(
      'match.previewAngle',
      promoArgs(setup, {
        beats: [
          beatArgs(BRAWL, [first]),
          beatArgs(WAR_OF_WORDS, [first]),
          beatArgs(PROMO.replace('promo', 'mystery') as typeof PROMO, [first]),
        ],
      }),
      PLAYER,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.map((reason) => [reason.code, reason.field])).toEqual([
        [PREVIEW_ANGLE_REASON_CODES.beatNotAllowed, 'beats[0].beatKey'],
        [PREVIEW_ANGLE_REASON_CODES.emptyGroup, 'beats[1].groupTwo'],
        [PREVIEW_ANGLE_REASON_CODES.unknownBeat, 'beats[2].beatKey'],
      ]);
    }
  });

  it('warns about sides booking cannot store and someone hurt in a physical beat', () => {
    const setup = angleWorld();
    const [first, second, third] = setup.wrestlers;
    const result = previewAngle(
      setup,
      promoArgs(setup, {
        angleTypeKey: CONFRONTATION_TYPE,
        slotRole: 'mainEvent',
        beats: [
          beatArgs(STAREDOWN, [first, second], [third]),
          beatArgs(WAR_OF_WORDS, [first], [second]),
        ],
      }),
    );
    const conflict = result.warnings.find((warning) => warning.code === 'angle.sidesConflict');
    expect(conflict?.message).toMatch(
      / are together in beat 1 but opposed in beat 2; booking can't store that$/,
    );
  });

  it('warns about someone hurt in a physical beat, and too many people in a group', () => {
    const setup = angleWorld();
    const [first, second, third] = setup.wrestlers;
    updatePerson(setup.world, first, (row) => ({
      ...row,
      injury: {
        kindKey: parseContentKey('injury.torn-shoulder'),
        bodyPart: 'arms',
        since: setup.world.meta.currentDate,
        expectedReturn: addDays(setup.world.meta.currentDate, 30),
        canWorkAngles: true,
      },
    }));
    const result = previewAngle(
      setup,
      promoArgs(setup, {
        angleTypeKey: CONFRONTATION_TYPE,
        slotRole: 'mainEvent',
        beats: [
          beatArgs(STAREDOWN, [first], [second]),
          beatArgs(BRAWL, [first, second]),
          beatArgs(STAREDOWN, [first], [second, third, setup.manager, ...setup.rivals]),
        ],
      }),
    );
    expect(
      result.warnings.map((warning) => [warning.code, warning.beatIndex, warning.message]),
    ).toEqual(
      expect.arrayContaining([
        ['angle.groupTooBig', 2, 'Staredown takes at most 4 people on side B'],
        [
          'angle.injuredInPhysicalBeat',
          1,
          expect.stringMatching(/ is hurt: the brawl in beat 2 is physical$/),
        ],
      ]),
    );
  });

  it('refuses a save without a beat catalog', () => {
    const setup = angleWorld();
    const result = setup.world.transact('drop beats', (tx) => {
      const { beats: _beats, ...catalogs } = setup.world.meta.catalogs;
      tx.setMeta({ catalogs });
    });
    if (!result.ok) {
      throw result.error;
    }
    const answer = setup.engine.query('match.previewAngle', promoArgs(setup), PLAYER);
    expect(answer.ok).toBe(false);
    if (!answer.ok) {
      expect(answer.reasons).toEqual([
        { code: PREVIEW_ANGLE_REASON_CODES.noBeatCatalog, message: NO_BEAT_CATALOG_MESSAGE },
      ]);
    }
  });
});
