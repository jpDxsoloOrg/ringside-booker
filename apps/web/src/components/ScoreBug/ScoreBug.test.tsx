import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REDUCED_MOTION_QUERY } from '@/styles/useReducedMotion';
import { setMatchMedia } from '@/test/matchMedia';
import { ScoreBug } from './ScoreBug';
import type { ScoreBugStats } from './ScoreBug';

const LAST_SHOW: ScoreBugStats = [
  {
    id: 'overall',
    label: 'Overall',
    value: '78',
    subValue: '3.75 stars',
    why: <button type="button">Why? Overall</button>,
  },
  { id: 'gate', label: 'Gate', value: '91.7%', subValue: '6,420 / 7,000' },
  { id: 'viewers', label: 'Viewers', value: '1.1M', tone: 'prestige', highlight: true },
  { id: 'revenue', label: 'Net', value: '+$218K', tone: 'neutral' },
];

describe('ScoreBug', () => {
  it('is a named group of labelled values', () => {
    render(<ScoreBug label="Last show" stats={LAST_SHOW} />);

    const bug = screen.getByRole('group', { name: 'Last show' });
    expect(bug).toHaveAttribute('data-count', '4');
    const terms = within(bug).getAllByRole('term');
    expect(terms.map((term) => term.textContent)).toEqual(['Overall', 'Gate', 'Viewers', 'Net']);
    const definitions = within(bug).getAllByRole('definition');
    expect(definitions.map((definition) => definition.textContent)).toEqual([
      '78',
      '3.75 stars',
      'Why? Overall',
      '91.7%',
      '6,420 / 7,000',
      '1.1M',
      '+$218K',
    ]);
    expect(bug.querySelector('[style]')).toBeNull();
  });

  it('lays out one column per stat with the right tone', () => {
    render(<ScoreBug label="Last show" stats={LAST_SHOW} />);

    const bug = screen.getByRole('group', { name: 'Last show' });
    expect(bug.querySelector('dl')).toHaveClass('count-4');
    expect(within(bug).getByText('78')).toHaveClass('tone-data');
    expect(within(bug).getByText('1.1M')).toHaveClass('tone-prestige');
    expect(within(bug).getByText('1.1M').parentElement).toHaveClass('highlight');
  });

  it('puts the Why? chip in its slot as a working control', () => {
    render(<ScoreBug label="Last show" stats={LAST_SHOW} />);
    expect(screen.getByRole('button', { name: 'Why? Overall' })).toBeInTheDocument();
  });

  it('takes two stats', () => {
    render(
      <ScoreBug
        label="Projection"
        stats={[
          { id: 'rating', label: 'Projected rating', value: '2.45M' },
          { id: 'card', label: 'Card completion', value: '67%', tone: 'prestige' },
        ]}
      />,
    );
    const bug = screen.getByRole('group', { name: 'Projection' });
    expect(bug.querySelector('dl')).toHaveClass('count-2');
  });

  it('has no motion, so reduced motion renders it the same', () => {
    const { container: withMotion } = render(<ScoreBug label="Last show" stats={LAST_SHOW} />);
    setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    const { container: reduced } = render(<ScoreBug label="Last show" stats={LAST_SHOW} />);
    expect(reduced.innerHTML).toBe(withMotion.innerHTML);
  });
});
