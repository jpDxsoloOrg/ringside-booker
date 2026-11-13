// Card score. Design: docs/design/rival-booking.md#card-score
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import {
  cardScore,
  cardScoreText,
  NO_FEATURED_NOTE,
  storylineHeatText,
  NOBODY_IN_IT_NOTE,
  type CardScoreInputs,
} from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const tunables = createEngineTunables();

function score(overrides: Partial<CardScoreInputs> = {}, tuned = tunables) {
  const result = cardScore(
    {
      label: 'Haruto Ise vs Daichi Kuroe',
      kind: 'match',
      participantCardValues: [
        { name: 'Haruto Ise', value: 70 },
        { name: 'Daichi Kuroe', value: 50 },
      ],
      titles: [],
      storylines: [],
      featured: [],
      ...overrides,
    },
    { tunables: tuned },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function lineLabels(result: ReturnType<typeof score>): string[] {
  return [
    ...findTraceNodes(result.trace, 'add'),
    ...findTraceNodes(result.trace, 'multiply'),
    ...findTraceNodes(result.trace, 'note'),
  ].map((node) => node.label);
}

describe('cardScore', () => {
  it('starts from the mean card value, a line per person', () => {
    const result = score();
    expect(result.value).toBeCloseTo(60);
    expect(result.trace.label).toBe('Card score: Haruto Ise vs Daichi Kuroe');
    expect(lineLabels(result)).toEqual(expect.arrayContaining(['Haruto Ise', 'Daichi Kuroe']));
  });

  it('scores 0 with a note when nobody is in it', () => {
    const result = score({ participantCardValues: [] });
    expect(result.value).toBe(0);
    expect(lineLabels(result)).toContain(NOBODY_IN_IT_NOTE);
  });

  it('scales a talking segment by the talk factor, 0 and 1 included', () => {
    expect(score({ kind: 'angle' }).value).toBeCloseTo(48);
    const none = createEngineTunables({ 'aip.card.order.talkFactor': 0 });
    expect(score({ kind: 'angle' }, none).value).toBe(0);
    const whole = createEngineTunables({ 'aip.card.order.talkFactor': 1 });
    expect(score({ kind: 'angle' }, whole).value).toBeCloseTo(60);
    // Matches never read the talk factor.
    expect(score({}, none).value).toBeCloseTo(60);
  });

  it('adds prestige for each title and the hottest storyline only', () => {
    const titled = score({
      titles: [
        { name: 'World Title', prestige: 80 },
        { name: 'Tag Title', prestige: 40 },
      ],
    });
    expect(titled.value).toBeCloseTo(60 + 0.3 * 120);
    expect(lineLabels(titled)).toEqual(
      expect.arrayContaining(['The World Title is on the line', 'The Tag Title is on the line']),
    );
    const story = score({
      storylines: [
        { name: 'Ise vs Kuroe', heat: 64 },
        { name: 'Cold feud', heat: 10 },
      ],
    });
    expect(story.value).toBeCloseTo(60 + 0.2 * 64);
    expect(lineLabels(story)).toContain("Storyline 'Ise vs Kuroe' heat 64");
  });

  it('treats a weight of 0 as 0', () => {
    const flat = createEngineTunables({
      'aip.card.order.titleWeight': 0,
      'aip.card.order.heatWeight': 0,
    });
    const result = score(
      { titles: [{ name: 'World Title', prestige: 80 }], storylines: [{ name: 'S', heat: 90 }] },
      flat,
    );
    expect(result.value).toBeCloseTo(60);
  });

  it('gives the ace more than a prospect, and never both', () => {
    const ace = score({ featured: [{ name: 'Haruto Ise', kind: 'ace' }] });
    const prospect = score({ featured: [{ name: 'Daichi Kuroe', kind: 'prospect' }] });
    const both = score({
      featured: [
        { name: 'Daichi Kuroe', kind: 'prospect' },
        { name: 'Haruto Ise', kind: 'ace' },
      ],
    });
    expect(ace.value).toBeCloseTo(72);
    expect(prospect.value).toBeCloseTo(66);
    expect(both.value).toBeCloseTo(72);
    expect(lineLabels(ace)).toContain('Ace Haruto Ise');
    expect(lineLabels(prospect)).toContain('Prospect Daichi Kuroe');
  });

  it('says so when no ace or prospects are named yet, adding 0', () => {
    const result = score({ featuredNamed: false });
    expect(result.value).toBeCloseTo(60);
    expect(lineLabels(result)).toContain(NO_FEATURED_NOTE);
  });

  it('is never clamped', () => {
    const result = score({
      participantCardValues: [{ name: 'Star', value: 100 }],
      titles: [{ name: 'World Title', prestige: 100 }],
      featured: [{ name: 'Star', kind: 'ace' }],
    });
    expect(result.value).toBeCloseTo(142);
  });
});

describe('card score reasons', () => {
  it('reads in whole points for a list (AIP4-08)', () => {
    expect(cardScoreText(10.72)).toBe('Card score 11');
    expect(cardScoreText(71)).toBe('Card score 71');
    expect(storylineHeatText('Ise vs Kuroe', 63.6)).toBe("Storyline 'Ise vs Kuroe' heat 64");
  });
});
