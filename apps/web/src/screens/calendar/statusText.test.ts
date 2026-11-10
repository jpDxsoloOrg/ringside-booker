import { describe, expect, it } from 'vitest';
import { parseGameDate } from '@ringside/engine';
import { galleryRivalShow, galleryShow } from '@/screens/dev-gallery/fixtures/calendar';
import { statusText, statusTone } from './statusText';

const TUESDAY = parseGameDate('2027-01-05');

describe('statusText and statusTone', () => {
  it('names the open and finished statuses', () => {
    expect(statusText(galleryShow({ status: 'scheduled' }))).toBe('Scheduled');
    expect(statusTone(galleryShow({ status: 'scheduled' }))).toBe('data');
    expect(statusText(galleryShow({ status: 'booked' }))).toBe('Booked');
    expect(statusTone(galleryShow({ status: 'booked' }))).toBe('action');
    expect(statusText(galleryShow({ status: 'completed' }))).toBe('Completed');
    expect(statusTone(galleryShow({ status: 'completed' }))).toBe('positive');
  });

  it('says when the viewer called their own show off', () => {
    const show = galleryShow({
      status: 'cancelled',
      cancellation: { reason: 'byPromotion', on: TUESDAY },
    });
    expect(statusText(show)).toBe('Cancelled by you on Tue 5 Jan 2027');
    expect(statusTone(show)).toBe('neutral');
  });

  it('only says a rival’s show was cancelled', () => {
    const show = galleryRivalShow(0, {
      status: 'cancelled',
      cancellation: { reason: 'byPromotion', on: TUESDAY },
    });
    expect(statusText(show)).toBe('Cancelled');
    expect(statusTone(show)).toBe('neutral');
  });

  it('tells a show that never had a card from one whose card did not run', () => {
    const notRun = {
      status: 'cancelled',
      cancellation: { reason: 'notRun', on: TUESDAY },
    } as const;
    expect(statusText(galleryShow({ ...notRun, segmentCount: 0 }))).toBe('Not run (no card)');
    expect(statusText(galleryShow({ ...notRun, segmentCount: 5 }))).toBe('Not run');
    expect(statusText(galleryRivalShow(0, { ...notRun, segmentCount: 0 }))).toBe(
      'Not run (no card)',
    );
    expect(statusTone(galleryShow(notRun))).toBe('negative');
  });

  it('says a projected show is not on the schedule yet', () => {
    const show = galleryShow({ status: 'projected' });
    expect(statusText(show)).toBe('Projected: not on the schedule yet');
    expect(statusTone(show)).toBe('neutral');
  });
});
