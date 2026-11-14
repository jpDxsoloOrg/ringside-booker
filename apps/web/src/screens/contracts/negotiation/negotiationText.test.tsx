import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import type { OfferUpdates } from '@ringside/engine';
import { AdvanceSummaryBanner, reportNeedsBanner } from '@/app/AppShell/day/AdvanceSummary';
import type { AdvanceReport } from '@/app/AppShell/day/DayAdvanceProvider';
import { offerUpdateLines, offerUpdatesNeedBanner, talksStateText } from './negotiationText';

const ID = parseId('negotiation', 'neg_0000000001');

const UPDATES: OfferUpdates = {
  countered: [
    { negotiationId: ID, ringName: 'Rhea Vance', outcomeMessage: 'Made a counter-offer' },
  ],
  signed: [{ negotiationId: ID, ringName: 'Kade Moreno', outcomeMessage: 'Signed' }],
  walkedAway: [{ negotiationId: ID, ringName: 'Joss Hale', outcomeMessage: 'Walked away' }],
  declined: [
    { negotiationId: ID, ringName: 'Ivo Lark', outcomeMessage: 'Signed with Crown Pro instead' },
  ],
  lapsed: [],
};

const NONE: OfferUpdates = { countered: [], signed: [], walkedAway: [], declined: [], lapsed: [] };

function oneDay(): AdvanceReport {
  return {
    kind: 'advanced',
    daysRequested: 1,
    result: {
      startDate: parseGameDate('2027-01-04'),
      endDate: parseGameDate('2027-01-04'),
      daysAdvanced: 1,
      stoppedBy: { kind: 'completed' },
      failures: [],
      eventsPublished: 0,
      timing: { ms: 1 },
    },
  };
}

describe('the Next Day summary lines about contract talks', () => {
  it('names each change in plain words, and any news earns the banner', () => {
    expect(offerUpdateLines(UPDATES)).toEqual([
      'Rhea Vance countered',
      'Signed Kade Moreno',
      'Joss Hale walked away',
      'Ivo Lark: signed with Crown Pro instead',
    ]);
    expect(offerUpdatesNeedBanner(UPDATES)).toBe(true);
    expect(offerUpdatesNeedBanner(NONE)).toBe(false);
    expect(reportNeedsBanner(oneDay())).toBe(false);
    expect(reportNeedsBanner(oneDay(), { offerUpdates: true })).toBe(true);
  });

  it('shows three lines and "and 1 more", linking to Offers', () => {
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <AdvanceSummaryBanner
              report={oneDay()}
              onDismiss={() => undefined}
              offerUpdates={UPDATES}
            />
          ),
        },
      ],
      { initialEntries: ['/game'] },
    );
    render(<RouterProvider router={router} />);
    const list = screen.getByRole('list', { name: 'Contract talks' });
    expect(within(list).getByText('Rhea Vance countered')).toBeInTheDocument();
    expect(within(list).queryByText('Ivo Lark: signed with Crown Pro instead')).toBeNull();
    expect(within(list).getByRole('link', { name: 'and 1 more' })).toHaveAttribute(
      'href',
      '/game/contracts?tab=offers',
    );
  });

  it('says where talks with a free agent stand, bidders by count only', () => {
    expect(
      talksStateText({
        openNegotiationId: null,
        cooldownUntil: null,
        competingBidders: ['A', 'B'],
      }),
    ).toBe('2 other bidders');
    expect(
      talksStateText({ openNegotiationId: ID, cooldownUntil: null, competingBidders: [] }),
    ).toBe('Talking');
  });
});
