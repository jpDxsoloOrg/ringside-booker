import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('shows a title as a paragraph by default', () => {
    const { container } = render(<EmptyState title="No matches booked yet" />);

    expect(screen.getByText('No matches booked yet').tagName).toBe('P');
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.firstElementChild).toHaveClass('size-inline');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('can make the title a heading', () => {
    render(<EmptyState title="Inbox empty" headingLevel={2} size="page" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Inbox empty' })).toBeInTheDocument();
  });

  it('renders the icon, body and action', async () => {
    const user = userEvent.setup();
    const handleBook = vi.fn();
    const { container } = render(
      <EmptyState
        icon="calendar"
        title="Nothing scheduled"
        body="Book a show to fill the calendar."
        size="page"
        action={
          <Button variant="primary" onClick={handleBook}>
            Book a show
          </Button>
        }
      />,
    );

    expect(container.firstElementChild).toHaveClass('size-page');
    expect(container.querySelector('[data-icon="calendar"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(screen.getByText('Book a show to fill the calendar.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Book a show' }));
    expect(handleBook).toHaveBeenCalledTimes(1);
  });
});
