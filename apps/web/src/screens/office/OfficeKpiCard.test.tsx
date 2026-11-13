import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cents, parseGameDate, parseId, startCalc } from '@ringside/engine';
import { describe, expect, it } from 'vitest';
import { StatusChips } from '@/app/AppShell/status/StatusChips';
import { StatusStrip } from '@/app/AppShell/StatusStrip';
import { MINUS_SIGN } from '@/components/format';
import {
  galleryCashKpi,
  galleryPopularityKpi,
} from '@/screens/dev-gallery/fixtures/officeDashboard';
import { OfficeKpiCard } from './OfficeKpiCard';

const POPULARITY = 70.29;

describe('OfficeKpiCard popularity', () => {
  it('shows the same popularity text as the top-bar chip and the Why? panel', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <OfficeKpiCard
        kpi={{
          ...galleryPopularityKpi,
          value: POPULARITY,
          trace: startCalc('Altura Wrestling popularity', POPULARITY, { unit: 'points' }).done()
            .trace,
        }}
      />,
    );
    const card = screen.getByRole('button', { name: /^Why is Popularity / });
    render(
      <StatusChips
        placement="bar"
        onOpenFanBase={() => undefined}
        status={{
          date: parseGameDate('2031-01-26'),
          season: null,
          promotion: {
            promotionId: parseId('promotion', 'pro_00000000ab'),
            name: 'Altura Wrestling',
            shortName: 'AWE',
            cash: cents(100_000_00),
            cashTraceRef: null,
            popularity: {
              homeRegionId: parseId('region', 'reg_00000000ab'),
              homeRegion: 75.06,
              prestige: 80,
              headline: POPULARITY,
              headlineLabel: 'Popularity in United States',
              traceRef: null,
              trace: startCalc('Popularity in United States', POPULARITY, {
                unit: 'points',
              }).done().trace,
            },
          },
        }}
      />,
    );
    render(
      <StatusStrip
        compact={false}
        status={{
          date: parseGameDate('2031-01-26'),
          week: 4,
          season: 1,
          cash: cents(100_000_00),
          cashDelta: null,
          popularity: POPULARITY,
        }}
      />,
    );

    expect(within(screen.getByTestId('popularity-chip')).getByText('70.3')).toBeInTheDocument();
    expect(within(screen.getByTestId('top-bar-status')).getByText('70.3')).toBeInTheDocument();
    expect(card).toHaveAccessibleName('Why is Popularity 70.3?');
    expect(screen.queryByText('70.29')).toBeNull();

    await user.click(card);
    const panel = await screen.findByRole('dialog', { name: 'Popularity' });
    expect(within(panel).getAllByText('70.3').length).toBeGreaterThan(0);
  });
});

describe('OfficeKpiCard money Why?', () => {
  it('shows every step of the cash change in dollars, not cents', async () => {
    const user = userEvent.setup({ delay: null });
    render(<OfficeKpiCard kpi={galleryCashKpi} />);

    await user.click(screen.getByRole('button', { name: /^Why is change in cash/ }));

    const tree = await screen.findByRole('tree', { name: /Breakdown of Change in cash/ });
    expect(within(tree).getByText('This week (Tue 26 Jan): $161,250')).toBeInTheDocument();
    expect(
      within(tree).getByText(`${MINUS_SIGN}$166,100 Last week (Mon 18 Jan)`),
    ).toBeInTheDocument();
    expect(within(tree).getByText(`$161,250 → ${MINUS_SIGN}$4,850`)).toBeInTheDocument();
  });
});
