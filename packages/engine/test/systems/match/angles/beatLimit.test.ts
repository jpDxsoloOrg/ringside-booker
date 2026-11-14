// Beat limits per duration class (MTCH5-03). Design: docs/design/angle-rating.md#beat-limits
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import { MAX_ANGLE_BEATS } from '../../../../src/model/entities/segment';
import {
  angleTunables,
  beatLimitMessage,
  beatLimitOf,
  overLimitNote,
  PREVIEW_ANGLE_REASON_CODES,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectTraceReplays } from '../../../support/trace';
import { angleWorld, beatArgs, PLAYER, promoArgs, PROMO, WAR_OF_WORDS } from './angle-world';

describe('beatLimitOf', () => {
  it('reads each duration class from its tunable, titled with the message', () => {
    const tunables = createEngineTunables();
    const short = beatLimitOf('short', tunables);
    expect(short.value).toBe(2);
    expect(short.trace.label).toBe('Short slot: up to 2 beats');
    expect(findTraceNodes(short.trace, 'tunable').map((node) => node.key)).toEqual([
      'match.angle.maxBeats.short',
    ]);
    expectTraceReplays(short);
    expect(beatLimitOf('standard', tunables).value).toBe(4);
    expect(beatLimitOf('long', tunables).value).toBe(6);
  });

  it('follows overrides, and the tunables can never go above the schema', () => {
    const tunables = createEngineTunables({ 'match.angle.maxBeats.long': 8 });
    expect(beatLimitOf('long', tunables).value).toBe(8);
    for (const key of [
      'match.angle.maxBeats.short',
      'match.angle.maxBeats.standard',
      'match.angle.maxBeats.long',
    ] as const) {
      expect(angleTunables[key].max).toBe(MAX_ANGLE_BEATS);
      expect(angleTunables[key].min).toBe(1);
    }
  });

  it('words the message per class, with "beat" at 1', () => {
    expect(beatLimitMessage('short', 2)).toBe('Short slot: up to 2 beats');
    expect(beatLimitMessage('standard', 4)).toBe('Standard slot: up to 4 beats');
    expect(beatLimitMessage('long', 6)).toBe('Long slot: up to 6 beats');
    expect(beatLimitMessage('short', 1)).toBe('Short slot: up to 1 beat');
    expect(overLimitNote('short', 2)).toBe('Only the first 2 beats count in a short slot');
    expect(overLimitNote('short', 1)).toBe('Only the first beat counts in a short slot');
  });
});

describe('match.previewAngle beat limit', () => {
  // MTCH1 makes the opener a standard slot by default; the pre-show is the short one.
  it('refuses 3 beats on the pre-show (short) and accepts them in the main event', () => {
    const setup = angleWorld();
    const [first, second, third] = setup.wrestlers;
    const beats = [
      beatArgs(PROMO, [first]),
      beatArgs(WAR_OF_WORDS, [first], [second]),
      beatArgs(PROMO, [third]),
    ];
    const preShow = setup.engine.query(
      'match.previewAngle',
      promoArgs(setup, { slotRole: 'preShow', beats }),
      PLAYER,
    );
    expect(preShow.ok).toBe(false);
    if (!preShow.ok) {
      expect(preShow.reasons).toEqual([
        {
          code: PREVIEW_ANGLE_REASON_CODES.tooManyBeats,
          message: 'Short slot: up to 2 beats',
          field: 'beats',
        },
      ]);
    }
    const main = setup.engine.query(
      'match.previewAngle',
      promoArgs(setup, { slotRole: 'mainEvent', beats }),
      PLAYER,
    );
    expect(main.ok).toBe(true);
    if (main.ok) {
      expect(main.data.beatLimit).toEqual({ max: 6, message: 'Long slot: up to 6 beats' });
      expect(main.data.beats.every((beat) => beat.counted)).toBe(true);
    }
  });
});
