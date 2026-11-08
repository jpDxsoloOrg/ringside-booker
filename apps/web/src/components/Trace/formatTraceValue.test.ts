import { describe, expect, it } from 'vitest';
import { MINUS_SIGN } from '../format';
import { formatTraceDelta, formatTraceNumber, formatTraceValue } from './formatTraceValue';

describe('formatTraceNumber', () => {
  it('formats money from cents, with a true minus sign for losses', () => {
    expect(formatTraceNumber(125_000, 'money')).toBe('$1,250');
    expect(formatTraceNumber(-125_000, 'money')).toBe(`${MINUS_SIGN}$1,250`);
    expect(formatTraceNumber(0, 'money')).toBe('$0');
  });

  it('rounds a fraction of a cent that a multiplier left behind', () => {
    expect(formatTraceNumber(12_345.6, 'money')).toBe('$123');
  });

  it('formats money per month', () => {
    expect(formatTraceNumber(500_000, 'money/month')).toBe('$5,000/month');
  });

  it('reads percent on its 0 to 100 scale', () => {
    expect(formatTraceNumber(15.3, 'percent')).toBe('15.3%');
    expect(formatTraceNumber(84, 'percent')).toBe('84%');
  });

  it('turns a 0 to 1 probability into a percentage', () => {
    expect(formatTraceNumber(0.153, 'probability')).toBe('15.3%');
    expect(formatTraceNumber(0.35, 'probability')).toBe('35%');
  });

  it('shows a ratio as a plain factor and a multiplier with its sign', () => {
    expect(formatTraceNumber(0.885, 'ratio')).toBe('0.885');
    expect(formatTraceNumber(1.06251, 'multiplier')).toBe('×1.063');
    expect(formatTraceNumber(1.15, 'ratio')).toBe('1.15');
    expect(formatTraceNumber(1.15, 'multiplier')).toBe('×1.15');
  });

  it('shows points with up to two decimals', () => {
    expect(formatTraceNumber(37.6, 'points')).toBe('37.6');
    expect(formatTraceNumber(71, 'points')).toBe('71');
    expect(formatTraceNumber(4, 'points/day')).toBe('4/day');
  });

  it('shows stars with the star sign', () => {
    expect(formatTraceNumber(3.75, 'stars')).toBe('3.75★');
  });

  it('names days, months and people, singular for one', () => {
    expect(formatTraceNumber(3, 'days')).toBe('3 days');
    expect(formatTraceNumber(1, 'days')).toBe('1 day');
    expect(formatTraceNumber(2, 'months')).toBe('2 months');
    expect(formatTraceNumber(12_400, 'people')).toBe('12,400 people');
    expect(formatTraceNumber(1, 'people')).toBe('1 person');
  });

  it('groups a count', () => {
    expect(formatTraceNumber(12_400, 'count')).toBe('12,400');
  });

  it('falls back to the number with up to two decimals', () => {
    expect(formatTraceNumber(2.345678)).toBe('2.35');
    expect(formatTraceNumber(-4)).toBe(`${MINUS_SIGN}4`);
  });
});

describe('formatTraceValue', () => {
  it('formats numbers in their unit', () => {
    expect(formatTraceValue(9000, 'people')).toBe('9,000 people');
  });

  it('reads booleans as yes and no, keeps text and shows a dash for no value', () => {
    expect(formatTraceValue(true)).toBe('yes');
    expect(formatTraceValue(false)).toBe('no');
    expect(formatTraceValue('Main event (long)')).toBe('Main event (long)');
    expect(formatTraceValue(null)).toBe('–');
  });
});

describe('formatTraceDelta', () => {
  it('always shows the sign', () => {
    expect(formatTraceDelta(6, 'points')).toBe('+6');
    expect(formatTraceDelta(-4, 'points')).toBe(`${MINUS_SIGN}4`);
    expect(formatTraceDelta(-50_000, 'money')).toBe(`${MINUS_SIGN}$500`);
    expect(formatTraceDelta(2.5, 'percent')).toBe('+2.5%');
  });

  it('shows a change too small to see as ±0', () => {
    expect(formatTraceDelta(0)).toBe('±0');
    expect(formatTraceDelta(0.001)).toBe('±0');
  });
});
