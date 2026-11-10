import { AVAILABILITY_STATUSES, parseGameDate } from '@ringside/engine';
import type { Availability } from '@ringside/engine';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_LABELS,
  AVAILABILITY_TONES,
  AvailabilityChip,
  availabilityReturnText,
} from './AvailabilityChip';

function availability(overrides: Partial<Availability> = {}): Availability {
  return {
    status: 'available',
    reason: 'Available',
    until: null,
    canWorkAngles: true,
    ...overrides,
  };
}

describe('AvailabilityChip', () => {
  it.each(AVAILABILITY_STATUSES)('says %s in words, not only in colour', (status) => {
    const { container } = render(<AvailabilityChip availability={availability({ status })} />);

    const chip = container.querySelector('[data-status]');
    expect(chip).toHaveAttribute('data-status', status);
    expect(screen.getByText(AVAILABILITY_LABELS[status])).toHaveClass(
      'badge',
      `tone-${AVAILABILITY_TONES[status]}`,
    );
  });

  it('has a label and a tone for every status the engine knows', () => {
    expect(Object.keys(AVAILABILITY_LABELS).sort()).toEqual([...AVAILABILITY_STATUSES].sort());
    expect(Object.keys(AVAILABILITY_TONES).sort()).toEqual([...AVAILABILITY_STATUSES].sort());
  });

  it('colours a working status green, an injury red and a spell away gold', () => {
    expect(AVAILABILITY_TONES.available).toBe('positive');
    expect(AVAILABILITY_TONES.injured).toBe('negative');
    for (const status of ['rehab', 'personalLeave', 'suspended', 'timeOff'] as const) {
      expect(AVAILABILITY_TONES[status]).toBe('prestige');
    }
    expect(AVAILABILITY_TONES.notDebuted).toBe('neutral');
    expect(AVAILABILITY_TONES.retired).toBe('neutral');
  });

  it('shows the first day back when there is one', () => {
    render(
      <AvailabilityChip
        availability={availability({
          status: 'injured',
          reason: 'Injured (leg injury)',
          until: parseGameDate('2026-04-14'),
        })}
      />,
    );

    expect(screen.getByText('back Apr 14, 2026')).toBeInTheDocument();
  });

  it('shows no return day when none is known', () => {
    render(
      <AvailabilityChip availability={availability({ status: 'retired', reason: 'Retired' })} />,
    );

    expect(screen.queryByText(/^back /)).toBeNull();
    expect(availabilityReturnText(null)).toBeNull();
  });

  it('gives the reason in a tooltip on keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <AvailabilityChip
        availability={availability({ status: 'suspended', reason: 'Suspended' })}
      />,
    );

    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Suspended');
  });

  it('keeps the reason in the chip for screen readers', () => {
    const { container } = render(
      <AvailabilityChip
        availability={availability({ status: 'rehab', reason: 'In rehab until spring' })}
      />,
    );

    expect(container.querySelector('[data-status]')).toHaveTextContent('In rehab until spring');
  });

  it('writes no inline styles', () => {
    const { container } = render(<AvailabilityChip availability={availability()} />);
    expect(container.querySelector('[style]')).toBeNull();
  });
});
