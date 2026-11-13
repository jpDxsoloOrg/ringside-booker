import { assertTraceReplays, inputOf, startCalc } from '@ringside/engine';
import type { TraceNode } from '@ringside/engine';
import { describe, expect, it } from 'vitest';
import {
  attendanceTrace,
  matchRatingTrace,
  summarisedAttendance,
} from '@/screens/dev-gallery/fixtures/traces';
import { MINUS_SIGN } from '../format';
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

describe('traceToText power steps', () => {
  it('words a power step as "raised to the power" with its label', () => {
    const trace: TraceNode = {
      kind: 'formula',
      label: 'Diminishing returns',
      value: 0.125,
      unit: 'ratio',
      children: [
        { kind: 'input', label: 'Share of fans still to win', value: 0.25 },
        {
          kind: 'power',
          label: 'Popularity curve',
          value: 0.125,
          operand: 1.5,
          before: 0.25,
          after: 0.125,
        },
      ],
    };
    expect(traceToText(trace).split('\n')).toEqual([
      'Diminishing returns: 0.125',
      '  Share of fans still to win: 0.25',
      '  raised to the power 1.5 (Popularity curve) · 0.25 → 0.125',
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

describe('traceToText step units', () => {
  const stepLines = (trace: TraceNode): string[] => traceToText(trace).split('\n').slice(1);

  it('reads every step of a money calculation as money', () => {
    const trace = startCalc('Change in cash since Mon 1 Feb', 3_870_320_840, {
      unit: 'money',
      startLabel: 'This week',
    })
      .subtract('Last week (Mon 1 Feb)', 3_903_713_859)
      .add('Refund', inputOf('Refund', 1_250))
      .multiply('Shows', inputOf('Shows this week', 2))
      .done().trace;

    expect(stepLines(trace)).toEqual([
      '  This week: $38,703,208',
      `  ${MINUS_SIGN}$39,037,139 Last week (Mon 1 Feb) · $38,703,208 → ${MINUS_SIGN}$333,930`,
      `  +$12.50 Refund · ${MINUS_SIGN}$333,930 → ${MINUS_SIGN}$333,918`,
      '    Refund: $12.50',
      `  ×2 Shows · ${MINUS_SIGN}$333,918 → ${MINUS_SIGN}$667,835`,
      '    Shows this week: 2',
    ]);
  });

  it('reads a monthly cost per month, and caps in the same unit', () => {
    const trace = startCalc('Monthly payroll', 0, { unit: 'money/month' })
      .add('Rex Vance', 500_000)
      .min('Payroll ceiling', 400_000)
      .done().trace;

    expect(stepLines(trace)).toEqual([
      '  Starting value: $0/month',
      '  +$5,000/month Rex Vance · $0/month → $5,000/month',
      '  Capped $5,000/month → $4,000/month (maximum) · Payroll ceiling',
    ]);
  });

  it('reads points, percent, counts and ratios in their own unit', () => {
    const popularity = startCalc('Popularity', 70, { unit: 'points' }).add('Show', 0.29).done();
    const share = startCalc('Share', 12, { unit: 'percent' }).add('Bonus', 3.25).done();
    const crowd = startCalc('Crowd', 1_200, { unit: 'count' }).add('Walk-ups', 1_030).done();
    const factor = startCalc('Form', 1, { unit: 'ratio' }).multiply('Hot', 1.0625).done();

    expect(stepLines(popularity.trace)[1]).toBe('  +0.3 Show · 70 → 70.3');
    expect(stepLines(share.trace)[1]).toBe('  +3.3% Bonus · 12% → 15.3%');
    expect(stepLines(crowd.trace)[1]).toBe('  +1,030 Walk-ups · 1,200 → 2,230');
    expect(stepLines(factor.trace)[1]).toBe('  ×1.063 Hot · 1 → 1.063');
  });

  it('shows a crowd times a price per head with each number in its own unit', () => {
    const trace = startCalc('Merch sales', inputOf('Crowd', 1_200, undefined, 'count'), {
      unit: 'money',
    })
      .add('Walk-ups', 30)
      .multiply('Spent per fan', inputOf('Per fan', 1_550, undefined, 'money'))
      .multiply('Show quality', 0.9)
      .done().trace;

    expect(stepLines(trace)).toEqual([
      '  Crowd: 1,200',
      '  +30 Walk-ups · 1,200 → 1,230',
      '  ×$15.50 Spent per fan · 1,230 → $19,065',
      '    Per fan: $15.50',
      '  ×0.9 Show quality · $19,065 → $17,159',
    ]);
  });
});
