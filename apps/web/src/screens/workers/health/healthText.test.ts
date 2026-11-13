// The Health tab's words (WRK6-05).
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '@ringside/engine';
import {
  BODY_PART_LABELS,
  daysLeftText,
  daysText,
  FATIGUE_BAND_LABELS,
  INJURY_SOURCE_LABELS,
  outUntilText,
  SEVERITY_LABELS,
  yesNo,
} from './healthText';

describe('health words', () => {
  it('names the six body parts, the severities, the fatigue bands and the sources', () => {
    expect(Object.values(BODY_PART_LABELS)).toEqual([
      'Head',
      'Neck',
      'Back',
      'Arms',
      'Torso',
      'Legs',
    ]);
    expect(Object.values(SEVERITY_LABELS)).toEqual(['Minor', 'Moderate', 'Severe']);
    expect(Object.values(FATIGUE_BAND_LABELS)).toEqual(['Fresh', 'Tired', 'Weary', 'Spent']);
    expect(INJURY_SOURCE_LABELS).toEqual({ world: 'Off-screen', segment: 'In a match' });
  });

  it('counts days in words', () => {
    expect(daysText(1)).toBe('1 day');
    expect(daysText(23)).toBe('23 days');
    expect(daysLeftText(0)).toBe('Back today');
    expect(daysLeftText(1)).toBe('Back tomorrow');
    expect(daysLeftText(23)).toBe('23 days left');
    expect(yesNo(true)).toBe('Yes');
    expect(yesNo(false)).toBe('No');
  });

  it('says when they are out until, and how long that is', () => {
    expect(outUntilText(parseGameDate('2027-03-14'), 23)).toBe(
      'Out until Mar 14, 2027 · 23 days left',
    );
  });
});
