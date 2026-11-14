// EVT4-08: the Time used bar, the editor's Time field and the draft's booked time.
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { parseContentKey } from '@ringside/engine';
import type { BookingSlotView, BookingTimeView, DurationClass } from '@ringside/engine';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import { TimeField, TIME_HINTS, usualTimeText } from './editor/TimeField';
import { emptyDraft, initialDraftState, setBookedTime } from './editor/useSegmentDraft';
import { TimeUsedBar, timeNoteText, timeUsedText } from './TimeUsedBar';

const TRACE = { kind: 'input', label: 'Time', value: 0 } as const;

function time(used: number, budget: number, extended = false): BookingTimeView {
  return {
    used,
    budget,
    over: Math.max(0, used - budget),
    extended,
    usedTrace: TRACE,
    budgetTrace: TRACE,
  };
}

function slot(role: BookingSlotView['role'], roleLabel: string): BookingSlotView {
  return {
    slot: 1,
    displayNumber: 2,
    preShow: false,
    role,
    roleLabel,
    durationClass: 'standard',
    durationLabel: 'Standard',
    usualTime: role === 'mainEvent' ? 'long' : 'standard',
    bookedTime: null,
    timeLocked: role === 'mainEvent',
    timeUnits: 2,
    weight: 1,
    roleTrace: TRACE,
    durationTrace: TRACE,
    weightTrace: TRACE,
    segment: null,
  };
}

describe('the Time used bar', () => {
  it('reads "14 of 16" and says how much room is left', () => {
    expect(timeUsedText(time(14, 16))).toBe('14 of 16');
    expect(timeNoteText(time(14, 16))).toMatch(/^Room for 2 more\./);
    expect(timeNoteText(time(16, 16))).toMatch(/^The show is full\./);
  });

  it('says in visible text how far over the show is and what to do', () => {
    render(<TimeUsedBar time={time(17, 15, true)} />);
    expect(screen.getByText('17 of 15')).toBeInTheDocument();
    expect(
      screen.getByText("Over the show's time by 2: shorten a match or drop a segment."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Why is Time used 17?' })).toBeInTheDocument();
  });

  it('never words the time as a running time (D-10)', () => {
    render(<TimeUsedBar time={time(14, 16)} />);
    expect(document.body.textContent).not.toMatch(RUNNING_TIME_WORDS);
    for (const hint of Object.values(TIME_HINTS)) {
      expect(hint).not.toMatch(RUNNING_TIME_WORDS);
    }
    expect(timeNoteText(time(17, 15))).not.toMatch(RUNNING_TIME_WORDS);
  });
});

describe('the Time field', () => {
  it('starts at the usual time and reports a new pick', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn<(length: DurationClass) => void>();
    render(
      <TimeField
        slot={slot('midcard', 'Midcard')}
        value={undefined}
        disabled={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Standard (usual)' })).toBeChecked();
    expect(screen.getByText(/Usual for the Midcard: Standard\./)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Long' }));
    expect(onChange).toHaveBeenCalledWith('long');
  });

  it('says the main event always runs long, with nothing to pick', () => {
    render(
      <TimeField
        slot={slot('mainEvent', 'Main event')}
        value={undefined}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Time: Long. The main event always runs long.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(usualTimeText(slot('opener', 'Opener'))).toBe('Usual for the Opener: Standard.');
  });
});

describe('the booked time in the draft', () => {
  const start = initialDraftState(emptyDraft('match', parseContentKey('match.singles')), {
    min: 2,
    max: 2,
  });

  it('stores a time other than the usual one', () => {
    expect(setBookedTime(start, 'long', 'standard').draft.bookedTime).toBe('long');
  });

  it('stores nothing for the usual time, so the segment follows its slot', () => {
    const long = setBookedTime(start, 'long', 'standard');
    const back = setBookedTime(long, 'standard', 'standard');
    expect('bookedTime' in back.draft).toBe(false);
    expect(setBookedTime(start, 'standard', 'standard')).toBe(start);
  });
});
