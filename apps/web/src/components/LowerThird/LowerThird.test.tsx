import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REDUCED_MOTION_QUERY } from '@/styles/useReducedMotion';
import { setMatchMedia } from '@/test/matchMedia';
import { LowerThird } from './LowerThird';
import type { LowerThirdMetaItem } from './LowerThird';

const META: readonly LowerThirdMetaItem[] = [
  { id: 'venue', label: 'Harbor Arena', icon: 'building' },
  { id: 'capacity', label: 'Capacity 8,500', icon: 'ticket' },
  { id: 'slot', label: 'Prime-time slot' },
];

function renderShowCard() {
  return render(
    <LowerThird
      kicker="Up next // In 3 days"
      title="Summit Thursday Night"
      meta={META}
      badge="Episode 128"
      wedge
      footer={<button type="button">Manage card</button>}
    >
      <p>Card 4 of 6 booked</p>
    </LowerThird>,
  );
}

describe('LowerThird', () => {
  it('is a section named by its title heading', () => {
    renderShowCard();

    const section = screen.getByRole('region', { name: 'Summit Thursday Night' });
    expect(
      within(section).getByRole('heading', { level: 2, name: 'Summit Thursday Night' }),
    ).toBeInTheDocument();
    expect(within(section).getByText('Up next // In 3 days')).toBeInTheDocument();
    expect(within(section).getByText('Episode 128')).toBeInTheDocument();
    expect(within(section).getByText('Card 4 of 6 booked')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Manage card' })).toBeInTheDocument();
    expect(section.querySelector('[style]')).toBeNull();
  });

  it('lists the meta row with decorative icons and hidden slashes', () => {
    renderShowCard();

    const section = screen.getByRole('region', { name: 'Summit Thursday Night' });
    const items = within(within(section).getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Harbor Arena',
      '//Capacity 8,500',
      '//Prime-time slot',
    ]);
    for (const item of items) {
      for (const hidden of item.querySelectorAll('svg, span[aria-hidden]')) {
        expect(hidden).toHaveAttribute('aria-hidden', 'true');
      }
    }
  });

  it('draws the wedge only when asked, hidden from screen readers', () => {
    const { container, unmount } = renderShowCard();
    expect(container.querySelector('[data-part="wedge"]')).toHaveAttribute('aria-hidden', 'true');
    unmount();

    render(<LowerThird kicker="Results" title="Saturday Night Slam" accent="data" />);
    const plain = screen.getByRole('region', { name: 'Saturday Night Slam' });
    expect(plain.querySelector('[data-part="wedge"]')).toBeNull();
    expect(plain).toHaveClass('accent-data');
    expect(within(plain).queryByRole('list')).toBeNull();
  });

  it('takes a heading level to fit the page outline', () => {
    render(<LowerThird kicker="Tonight" title="Go-home show" headingLevel={1} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Go-home show' })).toBeInTheDocument();
  });

  it('has no motion, so reduced motion renders it the same', () => {
    const { container: withMotion } = render(<LowerThird kicker="Tonight" title="Show" />);
    setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    const { container: reduced } = render(<LowerThird kicker="Tonight" title="Show" />);
    // useId differs between the two renders; everything else matches.
    const withoutIds = (html: string) => html.replace(/:r[0-9a-z]+:/g, 'id');
    expect(withoutIds(reduced.innerHTML)).toBe(withoutIds(withMotion.innerHTML));
  });
});
