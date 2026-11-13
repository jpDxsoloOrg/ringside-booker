// Default taste and tasteOf. Design: docs/design/rival-desk.md#taste
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../src/core/trace';
import { PROMOTION_STYLES } from '../../../src/model/entities/promotion-style';
import {
  DEFAULT_STYLE_TASTE,
  defaultTaste,
  STORED_TASTE_LABEL,
  styleTasteKey,
  TASTE_AXES,
  tasteOf,
  type Taste,
} from '../../../src/systems/aip';
import { createEngineTunables } from '../../../src/systems/tunables';
import { tinyWorld } from '../../support/worlds';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';

const tunables = createEngineTunables();

describe('defaultTaste', () => {
  it.each(PROMOTION_STYLES)('reads the eight %s keys', (style) => {
    const taste = defaultTaste({ style }, { tunables });
    expect(taste.source).toBe('style');
    for (const axis of TASTE_AXES) {
      expect(taste.values[axis]).toBe(DEFAULT_STYLE_TASTE[style][axis]);
      const trace = { value: taste.values[axis], trace: taste.traces[axis] };
      expectTraceReplays(trace);
      const keys = findTraceNodes(taste.traces[axis], 'tunable').map((node) => node.key);
      expect(keys).toEqual([styleTasteKey(style, axis)]);
    }
  });

  it('labels the taste with the style', () => {
    const taste = defaultTaste({ style: 'hardHitting' }, { tunables });
    expect(taste.label).toBe('Style taste: Hard-hitting');
    expect(taste.traces.wrestlingFocus.label).toBe('Wrestling focus');
    expect(taste.values).toEqual({
      wrestlingFocus: 80,
      entertainmentFocus: 30,
      athleticFocus: 40,
      starFocus: 50,
      talkShare: 15,
      titleFocus: 65,
      youthFocus: 40,
      riskAppetite: 55,
    });
  });

  it('gives 0 when a key is overridden to 0', () => {
    const zeroed = createEngineTunables({ [styleTasteKey('technical', 'wrestlingFocus')]: 0 });
    const taste = defaultTaste({ style: 'technical' }, { tunables: zeroed });
    expect(taste.values.wrestlingFocus).toBe(0);
    expect(taste.values.athleticFocus).toBe(45);
    expectTraceReplays({ value: 0, trace: taste.traces.wrestlingFocus });
  });
});

describe('tasteOf', () => {
  function promotions() {
    const { world, ids } = tinyWorld();
    const human = ids.promotions.A;
    const rival = ids.promotions.B;
    if (human === undefined || rival === undefined) {
      throw new Error('the tiny world has promotions A and B');
    }
    return { world, human, rival };
  }

  it("falls back to the promotion's style default when the profile has no taste", () => {
    const { world, rival } = promotions();
    const taste = tasteOf(world, tunables, rival);
    expect(taste.source).toBe('style');
    expect(taste.label).toBe('Style taste: Technical');
    expect(taste.values).toEqual(DEFAULT_STYLE_TASTE.technical);
  });

  it('gives a human promotion, which has no profile, its style default', () => {
    const { world, human } = promotions();
    const style = world.tables.promotions.get(human)?.style;
    if (style === undefined) {
      throw new Error('no promotion A');
    }
    const taste = tasteOf(world, tunables, human, null);
    expect(taste.source).toBe('style');
    expect(taste.values).toEqual(DEFAULT_STYLE_TASTE[style]);
  });

  it("prefers the profile's stored taste", () => {
    const { world, rival } = promotions();
    const stored: Taste = {
      wrestlingFocus: 10,
      entertainmentFocus: 20,
      athleticFocus: 30,
      starFocus: 40,
      talkShare: 50,
      titleFocus: 60,
      youthFocus: 70,
      riskAppetite: 80,
    };
    world.transact('set taste', (tx) => {
      const profile = tx.view.tables.aiProfiles.lookupOne('byUnit', `${rival}|-`);
      if (profile === undefined) {
        throw new Error('promotion B has no profile');
      }
      tx.update('aiProfiles', profile.id, { taste: stored });
    });
    const taste = tasteOf(world, tunables, rival);
    expect(taste.source).toBe('stored');
    expect(taste.label).toBe(STORED_TASTE_LABEL);
    expect(taste.values).toEqual(stored);
    expect(taste.traces.youthFocus).toMatchObject({ kind: 'input', value: 70 });
    expectSerialisable({ value: taste.values, trace: taste.traces.youthFocus });
  });
});
