import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VENUE_FITS, venueFitLabel } from '@ringside/engine';
import { VENUE_FIT_LOOKS, VenueFitBadge } from './VenueFitBadge';

describe('VenueFitBadge', () => {
  it.each([
    ['likelySellOut', 'Likely sell-out', 'tone-positive'],
    ['goodFit', 'Good fit', 'tone-data'],
    ['willLookEmpty', 'Will look empty', 'tone-negative'],
  ] as const)('draws %s as "%s" in its colour role with an icon', (fit, label, toneClass) => {
    const { container } = render(<VenueFitBadge fit={fit} />);
    const badge = screen.getByText(label);
    expect(badge).toHaveClass(toneClass);
    // The icon is drawn but hidden from screen readers: the words carry the meaning.
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('uses the engine’s words for every fit and a different icon for each', () => {
    for (const fit of VENUE_FITS) {
      expect(VENUE_FIT_LOOKS[fit].label).toBe(venueFitLabel(fit));
    }
    const icons = VENUE_FITS.map((fit) => VENUE_FIT_LOOKS[fit].icon);
    expect(new Set(icons).size).toBe(VENUE_FITS.length);
  });
});
