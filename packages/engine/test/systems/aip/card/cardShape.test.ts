// The card shape. Design: docs/design/rival-booking.md#card-shape
import { describe, expect, it } from 'vitest';
import { inputOf } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { EVENT_IMPORTANCES } from '../../../../src/model/entities/event-definition';
import {
  MAIN_EVENT_RULE,
  mainEventMustBeMatch,
  NO_BACK_TO_BACK_REASON,
  talkSlotsFor,
  titleMatchCapFor,
  type TalkSlotsInputs,
} from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const tunables = createEngineTunables();

function talkSlots(overrides: Partial<TalkSlotsInputs> = {}, tunableOverrides?: TunableOverrides) {
  const result = talkSlotsFor(
    { showName: 'Test Weekly', slots: 6, importance: 'regular', talkShare: 50, ...overrides },
    {
      tunables: tunableOverrides === undefined ? tunables : createEngineTunables(tunableOverrides),
    },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('talkSlotsFor', () => {
  it('plans 2 talking slots on a 6-slot regular show at neutral taste', () => {
    const result = talkSlots();
    expect(result.value).toBe(2);
    expect(result.trace.label).toBe('Talking segments on Test Weekly');
    expectTraceContains(result, { kind: 'input', label: 'Main-card slots' });
    expectTraceContains(result, { kind: 'multiply', label: 'Talking share for a regular show' });
    expectTraceContains(result, { kind: 'multiply', label: "Booker's taste for talking (50)" });
    expectTraceContains(result, { kind: 'round', label: 'Rounded' });
    const room = expectTraceContains(result, {
      kind: 'min',
      label: 'Room without back-to-back talking',
    });
    expect(room.limit).toBe(3);
    expect(room.applied).toBe(false);
  });

  it('plans none on a house show, whose share is 0', () => {
    expect(talkSlots({ importance: 'house' }).value).toBe(0);
    expect(talkSlots({ importance: 'house', talkShare: 100 }).value).toBe(0);
  });

  it('moves down at taste 0 and up at taste 100', () => {
    expect(talkSlots({ talkShare: 0 }).value).toBe(1);
    expect(talkSlots({ talkShare: 100 }).value).toBe(3);
  });

  it('takes a traced taste and keeps its trace', () => {
    const result = talkSlots({ talkShare: inputOf('Talk share (Booker taste)', 100) });
    expect(result.value).toBe(3);
    expectTraceContains(result, { kind: 'input', label: 'Talk share (Booker taste)' });
  });

  it('caps the share at aip.card.maxTalkShare', () => {
    const capped = talkSlots({ slots: 12, talkShare: 100 }, { 'aip.card.maxTalkShare': 0.1 });
    // 0.3 × 1.5 = 0.45, capped to 0.1: 12 × 0.1 = 1.2, rounded to 1.
    expect(capped.value).toBe(1);
    const clamp = expectTraceContains(capped, {
      kind: 'clamp',
      label: 'Within the largest talking share',
    });
    expect(clamp.applied).toBe(true);
    expect(talkSlots({ slots: 12 }, { 'aip.card.maxTalkShare': 0 }).value).toBe(0);
  });

  it('gives 0 when the show share is overridden to 0 (0 means 0)', () => {
    expect(talkSlots({ talkShare: 100 }, { 'aip.card.talkShare.regular': 0 }).value).toBe(0);
  });

  it('ignores taste when the swing is 0 and removes talk at taste 0 when it is 1', () => {
    expect(talkSlots({ talkShare: 100 }, { 'aip.card.talkTasteSwing': 0 }).value).toBe(2);
    expect(talkSlots({ talkShare: 0 }, { 'aip.card.talkTasteSwing': 1 }).value).toBe(0);
  });

  it('never puts more than 1 talking slot on a 3-slot show', () => {
    for (const importance of EVENT_IMPORTANCES) {
      for (const talkShare of [0, 50, 100]) {
        const result = talkSlots(
          { slots: 3, importance, talkShare },
          {
            'aip.card.talkShare.house': 1,
            [`aip.card.talkShare.${importance}`]: 1,
            'aip.card.maxTalkShare': 1,
          },
        );
        expect(result.value).toBeLessThanOrEqual(importance === 'house' ? 2 : 1);
      }
    }
    const regular = talkSlots(
      { slots: 3, talkShare: 100 },
      { 'aip.card.talkShare.regular': 1, 'aip.card.maxTalkShare': 1 },
    );
    expect(regular.value).toBe(1);
    const room = expectTraceContains(regular, {
      kind: 'constant',
      label: 'Room without back-to-back talking',
    });
    expect(room.reason).toContain(NO_BACK_TO_BACK_REASON);
  });

  it('leaves a house show room for every other slot, the last one included', () => {
    const result = talkSlots(
      { slots: 5, importance: 'house' },
      { 'aip.card.talkShare.house': 1, 'aip.card.maxTalkShare': 1 },
    );
    expect(result.value).toBe(3);
  });

  it('never mentions minutes or length', () => {
    const text = JSON.stringify(talkSlots().trace).toLowerCase();
    expect(text).not.toMatch(/minute|length|duration/);
  });
});

describe('titleMatchCapFor', () => {
  it('reads the cap of the show importance', () => {
    const result = titleMatchCapFor({ importance: 'major', matchSlots: 8 }, { tunables });
    expect(result.value).toBe(4);
    expectTraceReplays(result);
    expectSerialisable(result);
    expectTraceContains(result, { kind: 'min', label: 'Most title matches on a major show' });
  });

  it('never exceeds the match slots', () => {
    for (const importance of EVENT_IMPORTANCES) {
      for (const matchSlots of [0, 1, 2, 3, 6, 12]) {
        const result = titleMatchCapFor({ importance, matchSlots }, { tunables });
        expect(result.value).toBeLessThanOrEqual(matchSlots);
        expectTraceReplays(result);
        expectSerialisable(result);
      }
    }
    expect(titleMatchCapFor({ importance: 'flagship', matchSlots: 3 }, { tunables }).value).toBe(3);
  });

  it('gives 0 when the cap is overridden to 0', () => {
    const zero = createEngineTunables({ 'aip.titles.maxPerShow.regular': 0 });
    expect(
      titleMatchCapFor({ importance: 'regular', matchSlots: 4 }, { tunables: zero }).value,
    ).toBe(0);
  });
});

describe('mainEventMustBeMatch', () => {
  it('lets a house show end on anything and makes every other show end on a match', () => {
    for (const importance of EVENT_IMPORTANCES) {
      const result = mainEventMustBeMatch(importance);
      expect(result.value).toBe(importance !== 'house');
      expectSerialisable(result);
      const decision = expectTraceContains(result, { kind: 'decision' });
      expect(decision.reason).toBe(MAIN_EVENT_RULE);
    }
  });
});
