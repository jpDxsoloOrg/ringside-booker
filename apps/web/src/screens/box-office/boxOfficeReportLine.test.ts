import { cents } from '@ringside/engine';
import type { ShowCrowd, ShowMoney } from '@ringside/engine';
import { describe, expect, it } from 'vitest';
import { boxOfficeReportLine } from './boxOfficeReportLine';

const settled: ShowCrowd = {
  status: 'settled',
  venue: null,
  attendance: 4_210,
  capacity: 4_576,
  percentFull: 92,
  attendanceTraceRef: null,
};

function amount(value: number) {
  return { amount: cents(value), traceRef: null };
}

const money: ShowMoney = {
  ticketPrice: amount(1_200),
  grossGate: amount(5_052_000),
  gateShare: amount(222_000),
  tickets: amount(4_830_000),
  venueRent: amount(-1_100_000),
  grossMerch: amount(2_100_000),
  merchShare: amount(0),
  liveMerch: amount(2_100_000),
  net: amount(5_830_000),
};

describe('boxOfficeReportLine', () => {
  it("reads the crowd, how full the venue was and the gate on the player's show", () => {
    expect(boxOfficeReportLine(settled, money, 'full')).toEqual({
      label: 'Box office',
      text: 'Crowd 4,210 (92% full) · Gate $48,300',
      tone: 'neutral',
      targetId: 'results-section-boxOffice',
    });
  });

  it("leaves the gate out of a rival's line", () => {
    expect(boxOfficeReportLine(settled, null, 'full')?.text).toBe('Crowd 4,210 (92% full)');
  });

  it('has no line before the show is settled', () => {
    const notSettled: ShowCrowd = {
      ...settled,
      status: 'notSettled',
      attendance: null,
      percentFull: null,
    };
    expect(boxOfficeReportLine(notSettled, null, 'full')).toBeNull();
  });
});
