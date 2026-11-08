import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TONES } from '../tone';
import { Badge } from './Badge';
import { CountBadge, countBadgeText } from './CountBadge';

describe('Badge', () => {
  it('is a soft neutral label by default', () => {
    render(<Badge>Heel</Badge>);

    expect(screen.getByText('Heel')).toHaveClass('badge', 'soft', 'tone-neutral');
  });

  it.each(TONES)('takes the %s tone in both variants', (tone) => {
    render(
      <>
        <Badge tone={tone}>Soft {tone}</Badge>
        <Badge tone={tone} variant="solid">
          Solid {tone}
        </Badge>
      </>,
    );

    expect(screen.getByText(`Soft ${tone}`)).toHaveClass('soft', `tone-${tone}`);
    expect(screen.getByText(`Solid ${tone}`)).toHaveClass('solid', `tone-${tone}`);
  });
});

describe('CountBadge', () => {
  it('caps the visible number at 99+', () => {
    const { container } = render(<CountBadge count={150} label="150 unread" />);

    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('99+');
    expect(screen.getByText('150 unread')).toBeInTheDocument();
  });

  it('shows the number itself at or below the cap', () => {
    render(<CountBadge count={99} />);

    expect(screen.getAllByText('99')).toHaveLength(2);
  });

  it('honours a custom max', () => {
    expect(countBadgeText(10, 9)).toBe('9+');
    expect(countBadgeText(9, 9)).toBe('9');
  });

  it('is hidden at 0', () => {
    const { container } = render(<CountBadge count={0} label="0 unread" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows 0 when asked', () => {
    render(<CountBadge count={0} showZero label="No unread mail" />);

    expect(screen.getByText('No unread mail')).toBeInTheDocument();
  });

  it('gives screen readers the label, not the bare number', () => {
    const { container } = render(<CountBadge count={3} label="3 unread" />);

    expect(screen.getByText('3 unread')).toHaveClass('visuallyHidden');
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('3');
  });
});
