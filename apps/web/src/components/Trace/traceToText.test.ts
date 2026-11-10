import { assertTraceReplays } from '@ringside/engine';
import type { TraceNode } from '@ringside/engine';
import { describe, expect, it } from 'vitest';
import {
  attendanceTrace,
  matchRatingTrace,
  summarisedAttendance,
} from '@/screens/dev-gallery/fixtures/traces';
import { summaryToText, traceToText } from './traceToText';

describe('traceToText', () => {
  it('writes the attendance fixture as indented text in the panel wording', () => {
    expect(traceToText(attendanceTrace)).toMatchInlineSnapshot(`
      "Attendance: 9,000
        Venue size: 9,000
        ×0.84 Promotion popularity · 9,000 → 7,560 · Share of the venue a promotion this popular fills
          Popularity of the promotion in the region: 84%
          Percent scale: 100 · Fixed: percentages are stored as 0 to 100
        +900 Show hype · 7,560 → 8,460 · Card announced two weeks out
          Hype for this show: 60
          Fans per hype point: 15 · Custom setting · default 12 · attendance.hypeFans
        ×1.1 Weekend show · 8,460 → 9,306 · Saturday night crowd
        Walk-up crowd: rolled 212 on −500 to 500 (both ends possible) · Random stream attendance.walkUp
          Largest walk-up swing: 500 · Game setting · attendance.walkUpSwing
        +212 Walk-up crowd · 9,306 → 9,518
        Checked 9,518 against a minimum of 0: not reached · No negative crowd
        Capped 9,518 → 9,000 (maximum) · Kept between 0 and the venue size"
    `);
  });

  it('indents two spaces per level, one line per row', () => {
    const lines = traceToText(matchRatingTrace).split('\n');
    expect(lines[0]).toBe('Match rating: 71');
    expect(lines[1]).toBe('  Work rate: 68');
    expect(lines[2]).toBe('    Average ring skill: 70');
    expect(lines).toContain(
      '      Stamina check: 35% chance, came up no · Random stream match.stamina',
    );
    expect(lines).toContain('  Rounded 70.8 → 71');
  });

  it('includes checks that changed nothing, which the panel hides by default', () => {
    const text = traceToText(matchRatingTrace);
    expect(text).toContain('Did not apply: Title match');
    expect(text).toContain('Checked 71 against 0–100: already in range');
  });

  it('lists a decision root as a row with its options under it', () => {
    const decision: TraceNode = {
      kind: 'decision',
      label: 'Title decision',
      value: 'retain',
      chosen: 'retain',
      reason: 'Keeping the title scored higher',
      considered: [
        { option: 'change', score: 48 },
        { option: 'retain', score: 62, reason: 'Reign is still drawing' },
      ],
    };
    expect(traceToText(decision).split('\n')).toEqual([
      'Title decision: Retain',
      '  Title decision: Retain · Keeping the title scored higher',
      '    Chosen: Retain, score 62 · Reign is still drawing',
      '    Also considered: Change, score 48',
    ]);
  });
});

describe('summaryToText', () => {
  it('writes a summarised result with the notice and its top contributors', () => {
    expect(summaryToText(summarisedAttendance)).toMatchInlineSnapshot(`
      "Attendance: 6,400
        Full breakdown is only kept for recent results
        Recorded Feb 8, 2031
        −2,100 Promotion popularity
        +700 Show hype
        −150 Walk-up crowd"
    `);
  });
});

describe('gallery trace fixtures', () => {
  it.each([
    ['attendance', attendanceTrace],
    ['match rating', matchRatingTrace],
  ])('the %s trace replays to its value', (_name, trace) => {
    const { value } = trace;
    if (typeof value !== 'number') throw new Error('fixture value is not a number');
    expect(() => {
      assertTraceReplays({ value, trace });
    }).not.toThrow();
  });
});
