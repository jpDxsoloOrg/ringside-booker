import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { SegmentResultView } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createTraceFixtureTransport } from '@/screens/dev-gallery/fixtures/traceEngine';
import {
  drawResult,
  longNamesResult,
  noContestResult,
  promoSegment,
  singlesWin,
  tagNewChampions,
  tripleThreatRetained,
} from '@/screens/dev-gallery/fixtures/segmentResults';
import { SegmentResultCard } from './SegmentResultCard';
import {
  listText,
  reasonsLine,
  resultLine,
  resultWhyValue,
  segmentResultAccent,
} from './segmentResultText';

function withEngine(children: ReactNode) {
  return (
    <EngineProvider createTransport={() => createTraceFixtureTransport([])}>
      {children}
    </EngineProvider>
  );
}

function renderCard(segment: SegmentResultView, revealed = true) {
  render(withEngine(<SegmentResultCard segment={segment} revealed={revealed} />));
  return screen.getByRole('article');
}

function sideGroups(card: HTMLElement): HTMLElement[] {
  return within(card).getAllByRole('group', { name: /^Side \d/ });
}

describe('SegmentResultCard', () => {
  it('is an article named by its slot and role, with chips for class and type', () => {
    const card = renderCard(singlesWin());

    expect(screen.getByRole('article', { name: 'Slot 1: Opener' })).toBe(card);
    const chips = within(card).getByRole('list', { name: 'Segment details' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Short', 'Singles']);
    expect(card).toHaveAttribute('data-role', 'opener');
    expect(card.querySelector('[style]')).toBeNull();
  });

  it('marks the winning side on the right of a singles win and gives the method', () => {
    const card = renderCard(singlesWin());

    const left = within(card).getByRole('group', { name: 'Side 1: Vance Troy' });
    const right = within(card).getByRole('group', { name: 'Side 2, winner: Kai Moreno' });
    expect(within(right).getByText('Winner')).toBeInTheDocument();
    expect(within(left).queryByText('Winner')).toBeNull();
    expect(within(card).getByText('Kai Moreno def. Vance Troy · Pinfall')).toBeInTheDocument();
    expect(within(card).getByRole('list', { name: 'Storylines' })).toHaveTextContent(
      'Harbour grudge',
    );
  });

  it('lists every side of a three-way match', () => {
    const card = renderCard(tripleThreatRetained());

    expect(sideGroups(card)).toHaveLength(3);
    expect(
      within(card).getByText('Marlo Quint def. Sable Aranda and Jonah Pike · Pinfall'),
    ).toBeInTheDocument();
    expect(card).toHaveAttribute('data-role', 'mainEvent');
  });

  it('words a draw and a no contest without a winner', () => {
    for (const [segment, words] of [
      [drawResult(), 'Draw'],
      [noContestResult(), 'No contest'],
    ] as const) {
      const { unmount } = render(withEngine(<SegmentResultCard segment={segment} />));
      const card = screen.getByRole('article');
      expect(within(card).getByText(words, { selector: '[data-part="result"]' })).toBeVisible();
      expect(within(card).queryByText('Winner')).toBeNull();
      unmount();
    }
  });

  it('shows a talking segment as its type, with no winner and no work rate', () => {
    const card = renderCard(promoSegment());

    expect(within(card).getByText('Promo', { selector: '[data-part="result"]' })).toBeVisible();
    expect(within(card).queryByText('Winner')).toBeNull();
    expect(within(card).queryByText('Work rate')).toBeNull();
    expect(within(card).getByRole('list', { name: 'In the segment' })).toBeInTheDocument();
  });

  it('names the new holders in the NEW CHAMPION banner', () => {
    const card = renderCard(tagNewChampions());

    expect(within(card).getByText('NEW CHAMPION: Rook Halloway & Dax Ember')).toBeInTheDocument();
    expect(within(card).getByText('Coastline Tag Titles', { selector: 'span' })).toBeVisible();
    expect(
      within(card).getByRole('button', {
        name: 'Why is the Coastline Tag Titles outcome new champion?',
      }),
    ).toBeInTheDocument();
  });

  it('shows a Retained banner for a successful defence', () => {
    const card = renderCard(tripleThreatRetained());

    expect(within(card).getByText('Retained')).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: 'Why is the Coastal Crown outcome retained?' }),
    ).toBeInTheDocument();
  });

  it('shows the stars and a Why? on every number when there is a trace', () => {
    const card = renderCard(singlesWin());

    expect(within(card).getByRole('img', { name: '2.5 stars out of 5' })).toBeInTheDocument();
    for (const name of [
      'Why is Segment score 64?',
      'Why is Work rate 70?',
      'Why is Crowd 68?',
      'Why is Expected 58?',
    ]) {
      expect(within(card).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('gives the result line a Why? with the method and finish (EVT3-07)', () => {
    const card = renderCard(singlesWin());

    expect(
      within(card).getByRole('button', { name: 'Why is the result Pinfall · Clean?' }),
    ).toBeInTheDocument();
  });

  it('words the result Why? from the method and finish, else the kind of result', () => {
    expect(resultWhyValue({ kind: 'win', methodName: 'Pinfall', finishName: 'Clean finish' })).toBe(
      'Pinfall · Clean finish',
    );
    expect(resultWhyValue({ kind: 'draw', finishName: 'Stalemate' })).toBe('Stalemate');
    expect(resultWhyValue({ kind: 'draw' })).toBe('Draw');
    expect(resultWhyValue({ kind: 'noContest' })).toBe('No contest');
  });

  it('shows plain numbers and no Why? without a trace', () => {
    const segment = noContestResult();
    const card = renderCard(segment);

    expect(within(card).queryAllByRole('button')).toHaveLength(0);
    expect(within(card).getByText(String(segment.rating?.score))).toBeInTheDocument();
  });

  it('hides names and stars until revealed, keeping the card', () => {
    const segment = tripleThreatRetained();
    const card = renderCard(segment, false);

    expect(card).toHaveAttribute('data-state', 'hidden');
    expect(within(card).getByText('Coming up: Main event')).toBeInTheDocument();
    expect(within(card).queryAllByRole('group')).toHaveLength(0);
    expect(within(card).queryByRole('img', { name: /stars/ })).toBeNull();
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
    // The hidden copy only holds the space: it is out of the accessibility tree.
    expect(within(card).getByText('Marlo Quint').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('draws names through renderPersonLink', () => {
    render(
      withEngine(
        <SegmentResultCard
          segment={singlesWin()}
          renderPersonLink={(personId, name) => <a href={`#${personId}`}>{name}</a>}
        />,
      ),
    );

    expect(screen.getByRole('link', { name: 'Kai Moreno' })).toBeInTheDocument();
  });

  it('renders a footer and wraps long names in their own list items', () => {
    render(withEngine(<SegmentResultCard segment={longNamesResult()} footer={<p>More</p>} />));

    expect(screen.getByText('More')).toBeInTheDocument();
    expect(screen.getByText('Bartholomew "The Lighthouse" Vandermeer-Ashcombe').tagName).toBe('LI');
  });

  it('never mentions minutes', () => {
    for (const segment of [
      singlesWin(),
      tagNewChampions(),
      tripleThreatRetained(),
      drawResult(),
      noContestResult(),
      promoSegment(),
    ]) {
      const { container, unmount } = render(withEngine(<SegmentResultCard segment={segment} />));
      expect(container.textContent).not.toMatch(/minute/i);
      unmount();
    }
  });
});

describe('segment result text', () => {
  it('lists names in plain words', () => {
    expect(listText([])).toBe('');
    expect(listText(['A'])).toBe('A');
    expect(listText(['A', 'B'])).toBe('A and B');
    expect(listText(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('picks the accent like CardSlot', () => {
    expect(segmentResultAccent(tripleThreatRetained())).toBe('action');
    expect(segmentResultAccent(tagNewChampions())).toBe('prestige');
    expect(segmentResultAccent(singlesWin())).toBe('data');
  });

  it('has no result line for a match that has not run', () => {
    expect(resultLine({ ...singlesWin(), outcome: null })).toBeNull();
  });
});

describe('the top reasons (EVT3-09)', () => {
  it('shows the top two rating reasons in words under the numbers', () => {
    const base = singlesWin();
    const rating = base.rating;
    if (rating === null) throw new Error('Fixture has no rating');
    const segment: SegmentResultView = {
      ...base,
      rating: {
        ...rating,
        reasons: [
          { label: 'Strong work rate', effect: 8.4 },
          { label: 'Hot crowd', effect: 5 },
        ],
      },
    };
    const card = renderCard(segment);
    expect(within(card).getByText('Top reasons')).toBeInTheDocument();
    expect(
      within(card).getByText(/Strong work rate \(\+8\), hot crowd \(\+5\)/),
    ).toBeInTheDocument();
  });

  it('leaves the line out when the reasons are no longer kept', () => {
    const base = singlesWin();
    const rating = base.rating;
    if (rating === null) throw new Error('Fixture has no rating');
    const card = renderCard({ ...base, rating: { ...rating, reasons: [] } });
    expect(within(card).queryByText('Top reasons')).toBeNull();
  });

  it('writes negative effects with a true minus', () => {
    expect(reasonsLine([{ label: 'Quiet crowd', effect: -5.2 }])).toBe('Quiet crowd (−5)');
    expect(reasonsLine([])).toBeNull();
  });
});
