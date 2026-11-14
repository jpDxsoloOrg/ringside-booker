import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGameDate } from '@ringside/engine';
import { BUILTIN_SKIP_TARGETS, daysChoice, nextMonthChoice } from './builtinSkipTargets';
import {
  registerSkipTarget,
  skipTarget,
  skipTargets,
  useRegisteredSkipTargets,
  useResolvedSkipTargets,
} from './skipTargets';
import type { SkipTarget } from './skipTargets';

const removals: (() => void)[] = [];

function register(target: SkipTarget): void {
  removals.push(registerSkipTarget(target));
}

afterEach(() => {
  for (const remove of removals.splice(0)) remove();
});

function fixed(id: string, order: number): SkipTarget {
  return {
    id,
    label: id,
    order,
    useResolve: () => ({ request: { maxDays: order }, detail: id }),
  };
}

const LAST_OF_JANUARY = parseGameDate('2031-01-31');
const FIRST_OF_MARCH = parseGameDate('2031-03-01');
const LAST_OF_DECEMBER = parseGameDate('2031-12-31');

describe('the skip target registry', () => {
  it('lists the built-ins by order: 7, 30 and 90 days, then the month', () => {
    expect(skipTargets().map((target) => [target.id, target.order])).toEqual([
      ['days.7', 10],
      ['days.30', 20],
      ['days.90', 30],
      ['month.next', 40],
    ]);
    expect(BUILTIN_SKIP_TARGETS.map((target) => target.label)).toEqual([
      '7 days',
      '30 days',
      '90 days',
      'Until the 1st of next month',
    ]);
  });

  it('sorts by order, then by id, wherever a target was registered', () => {
    register(fixed('test.b', 50));
    register(fixed('test.a', 50));
    register(fixed('test.first', 5));
    expect(skipTargets().map((target) => target.id)).toEqual([
      'test.first',
      'days.7',
      'days.30',
      'days.90',
      'month.next',
      'test.a',
      'test.b',
    ]);
    expect(skipTarget('test.a')?.order).toBe(50);
  });

  it('refuses a duplicate id, and forgets a target once it is removed', () => {
    register(fixed('test.once', 60));
    expect(() => {
      registerSkipTarget(fixed('test.once', 61));
    }).toThrow('A skip target with id "test.once" is already registered.');
    expect(() => {
      registerSkipTarget(fixed('days.7', 1));
    }).toThrow(/days\.7/);
    for (const remove of removals.splice(0)) remove();
    expect(skipTarget('test.once')).toBeUndefined();
  });

  it('resolves every target in registration order, hides a null one and sorts the rest', () => {
    const called: string[] = [];
    const tracked = (id: string, order: number, shown: boolean): SkipTarget => ({
      id,
      label: id,
      order,
      useResolve: () => {
        called.push(id);
        return shown ? { request: { maxDays: 3 }, detail: id } : null;
      },
    });
    register(tracked('test.late', 5, true));
    register(tracked('test.hidden', 1, false));
    const { result, unmount } = renderHook(() => {
      const targets = useRegisteredSkipTargets();
      return useResolvedSkipTargets(targets, LAST_OF_JANUARY);
    });
    expect(called).toEqual(['test.late', 'test.hidden']);
    expect(result.current.map((entry) => entry.target.id)).toEqual([
      'test.late',
      'days.7',
      'days.30',
      'days.90',
      'month.next',
    ]);
    unmount();
  });
});

describe('the built-in skip targets', () => {
  it.each([
    [LAST_OF_JANUARY, 'to Fri 7 Feb 2031', 'to Sun 2 Mar 2031', 'to Thu 1 May 2031'],
    [FIRST_OF_MARCH, 'to Sat 8 Mar 2031', 'to Mon 31 Mar 2031', 'to Fri 30 May 2031'],
    [LAST_OF_DECEMBER, 'to Wed 7 Jan 2032', 'to Fri 30 Jan 2032', 'to Tue 30 Mar 2032'],
  ])('skips 7, 30 and 90 days from %s', (today, seven, thirty, ninety) => {
    expect(daysChoice(today, 7)).toEqual({ request: { maxDays: 7 }, detail: seven });
    expect(daysChoice(today, 30)).toEqual({ request: { maxDays: 30 }, detail: thirty });
    expect(daysChoice(today, 90)).toEqual({ request: { maxDays: 90 }, detail: ninety });
  });

  it.each([
    [LAST_OF_JANUARY, 1, '2031-02-01', 'Sat 1 Feb 2031 · 1 day'],
    [FIRST_OF_MARCH, 31, '2031-04-01', 'Tue 1 Apr 2031 · 31 days'],
    [LAST_OF_DECEMBER, 1, '2032-01-01', 'Thu 1 Jan 2032 · 1 day'],
  ])('stops at the 1st of next month from %s', (today, maxDays, stopAtDate, detail) => {
    expect(nextMonthChoice(today)).toEqual({ request: { maxDays, stopAtDate }, detail });
  });

  it('resolves the registered built-ins to the same requests', () => {
    const { result } = renderHook(() =>
      useResolvedSkipTargets(BUILTIN_SKIP_TARGETS, LAST_OF_DECEMBER),
    );
    expect(result.current.map((entry) => entry.choice.request)).toEqual([
      { maxDays: 7 },
      { maxDays: 30 },
      { maxDays: 90 },
      { maxDays: 1, stopAtDate: '2032-01-01' },
    ]);
  });
});
