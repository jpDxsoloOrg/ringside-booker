import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import type { OfferUpdates } from '@ringside/engine';
import { AdvanceSummaryBanner, reportNeedsBanner } from '@/app/AppShell/day/AdvanceSummary';
import type { AdvanceReport } from '@/app/AppShell/day/DayAdvanceProvider';
import {
  offerUpdateLines,
  offerUpdatesNeedBanner,
  signedText,
  talksStateText,
} from './negotiationText';

const ID = parseId('negotiation', 'neg_0000000001');

const UPDATES: OfferUpdates = {
  countered: [
    {
      negotiationId: ID,
      ringName: 'Rhea Vance',
      outcomeMessage: 'Made a counter-offer',
      line: 'Rhea Vance countered your offer',
    },
  ],
  signed: [
    {
      negotiationId: ID,
      ringName: 'Kade Moreno',
      outcomeMessage: 'Signed',
      line: 'Kade Moreno signed with you',
    },
  ],
  walkedAway: [
    {
      negotiationId: ID,
      ringName: 'Joss Hale',
      outcomeMessage: 'Walked away',
      line: 'Joss Hale walked away from your offer',
    },
  ],
  declined: [
    {
      negotiationId: ID,
      ringName: 'Ivo Lark',
      outcomeMessage: 'Signed with Crown Pro instead',
      line: 'Ivo Lark signed with Crown Pro instead',
    },
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
    // Signings first, then the answers that end talks, then counter-offers.
    expect(offerUpdateLines(UPDATES)).toEqual([
      'Kade Moreno signed with you',
      'Ivo Lark signed with Crown Pro instead',
      'Joss Hale walked away from your offer',
      'Rhea Vance countered your offer',
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
    expect(within(list).getByText('Kade Moreno signed with you')).toBeInTheDocument();
    expect(within(list).queryByText('Rhea Vance countered your offer')).toBeNull();
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

  it('confirms a signing in plain words', () => {
    expect(signedText('Rhea Cortez')).toBe(
      'Rhea Cortez has signed. They look forward to working with you.',
    );
    expect(signedText('Rhea Cortez', true)).toBe(
      'Rhea Cortez has signed the new contract. They look forward to working with you.',
    );
  });
});
