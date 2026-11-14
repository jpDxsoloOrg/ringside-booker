import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { galleryAcceptedValuation, galleryDealRows } from '@/screens/dev-gallery/fixtures/networks';
import { ProposalPreview } from '../ProposalPreview';
import { upliftChipText } from '../RenegotiateView';
import { dealTargetLines, ratingsBonusText } from './DealTargetsList';

function targetsOf(index: number) {
  const targets = galleryDealRows[index]?.targets;
  if (targets === null || targets === undefined) throw new Error('Expected targets');
  return targets;
}

describe('dealTargetLines (ECO8-10)', () => {
  it('says the three lines in viewers, with the share of what the network expects', () => {
    expect(dealTargetLines(targetsOf(0), 'tv').map((line) => line.text)).toEqual([
      'Stay above 1.5M (75% of 1.9M expected) to stay safe',
      'Below 1.1M (55%) they may cancel',
      'Beat 2.2M (115%) for a ratings bonus',
    ]);
    expect(dealTargetLines(targetsOf(0), 'tv').map((line) => line.short)).toEqual([
      'Safe above 1.5M',
      'May cancel below 1.1M',
      'Bonus above 2.2M',
    ]);
  });

  it('counts buys on pay-per-view, where the bonus is on the per-buy money', () => {
    const [safe] = dealTargetLines(targetsOf(1), 'ppv');
    expect(safe?.text).toBe('Stay above 113K buys (75% of 150K buys expected) to stay safe');
    expect(ratingsBonusText('ppv')).toContain('the per-buy money');
    expect(ratingsBonusText('tv')).toContain('the fee');
  });

  it('words the renewal uplift chip', () => {
    expect(upliftChipText(0.1)).toBe('+10% for beating expectations');
  });
});

describe('ProposalPreview: the targets (ECO8-10)', () => {
  it('lists what the network will expect, each line with its Why?', () => {
    render(
      <MemoryRouter>
        <ProposalPreview
          valuation={galleryAcceptedValuation}
          kind="tv"
          networkName="Bluebonnet Cable 7"
        />
      </MemoryRouter>,
    );
    const list = screen.getByRole('list', { name: 'What Bluebonnet Cable 7 expects of the deal' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getAllByRole('button', { name: /^Why is / })).toHaveLength(3);
    expect(screen.getByText(/every airing pays a ratings bonus/)).toBeInTheDocument();
  });
});
