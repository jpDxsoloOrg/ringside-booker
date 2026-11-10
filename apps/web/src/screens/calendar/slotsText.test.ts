import { describe, expect, it } from 'vitest';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import { IMPORTANCE_LABELS } from './importance';
import { slotsText } from './slotsText';
import { PROJECTED_STATUS_TEXT } from './statusText';

describe('slotsText', () => {
  it('counts the main slots', () => {
    expect(slotsText({ slots: 6, preShowSlots: 0 })).toBe('6 main slots');
    expect(slotsText({ slots: 3, preShowSlots: 0 })).toBe('3 main slots');
  });

  it('adds the pre-show slots when there are any', () => {
    expect(slotsText({ slots: 8, preShowSlots: 1 })).toBe('8 main slots + 1 pre-show');
    expect(slotsText({ slots: 10, preShowSlots: 2 })).toBe('10 main slots + 2 pre-show');
    expect(slotsText({ slots: 12, preShowSlots: 3 })).toBe('12 main slots + 3 pre-show');
  });

  it('never says how long a show runs', () => {
    for (let slots = 3; slots <= 12; slots += 1) {
      for (let preShowSlots = 0; preShowSlots <= 3; preShowSlots += 1) {
        expect(slotsText({ slots, preShowSlots })).not.toMatch(RUNNING_TIME_WORDS);
      }
    }
  });
});

describe('the calendar’s fixed wording', () => {
  it('never says how long a show runs', () => {
    for (const text of [...Object.values(IMPORTANCE_LABELS), PROJECTED_STATUS_TEXT]) {
      expect(text).not.toMatch(RUNNING_TIME_WORDS);
    }
  });

  it('would catch a running time if one crept in', () => {
    expect('120 minutes').toMatch(RUNNING_TIME_WORDS);
    expect('90 min').toMatch(RUNNING_TIME_WORDS);
    expect('2 hours').toMatch(RUNNING_TIME_WORDS);
    expect('Show length').toMatch(RUNNING_TIME_WORDS);
    expect('Minor').not.toMatch(RUNNING_TIME_WORDS);
  });
});
