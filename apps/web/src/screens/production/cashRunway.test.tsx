import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { inputOf, parseId } from '@ringside/engine';
import type { CashRunwayView } from '@ringside/engine';
import {
  CashRunwayBannerView,
  CashRunwayCardView,
  runwayHeadline,
  runwayMonthsText,
  runwayWarns,
} from './cashRunway';

const money = (amount: number) => `$${String(amount / 100)}`;

/** Altura a few weeks in: losing about $4.3M a month with $35M in the bank. */
function aCashRunway(overrides: Partial<CashRunwayView> = {}): CashRunwayView {
  return {
    promotionId: parseId('promotion', 'pro_0000000001'),
    cash: 3_500_000_000,
    status: 'losingMoney',
    monthlyNet: -430_000_000,
    monthlyNetTrace: inputOf('Money a month at this rate', -430_000_000).trace,
    monthsLeft: 8.14,
    monthsLeftTrace: inputOf('Months of cash left', 8.14).trace,
    spend: {
      wages: 92_400_000,
      medical: 8_250_000,
      overhead: 121_465_000,
      showProduction: 209_763_110,
    },
    warnBelowMonths: 6,
    daysUntilForecast: 0,
    ...overrides,
  };
}

describe('the cash runway wording', () => {
  it('says the months in plain words', () => {
    expect(runwayMonthsText(0.4)).toBe('less than a month');
    expect(runwayMonthsText(1.2)).toBe('about 1 month');
    expect(runwayMonthsText(8.14)).toBe('about 8 months');
  });

  it('leads with one sentence per status', () => {
    expect(runwayHeadline(aCashRunway(), money)).toBe(
      'At this rate you run out of cash in about 8 months.',
    );
    expect(
      runwayHeadline(
        aCashRunway({ status: 'makingMoney', monthlyNet: 210_000, monthsLeft: null }),
        money,
      ),
    ).toBe('At this rate your cash grows by about $2100 a month.');
    expect(
      runwayHeadline(
        aCashRunway({
          status: 'tooEarly',
          monthlyNet: -50_000,
          monthsLeft: null,
          daysUntilForecast: 7,
        }),
        money,
      ),
    ).toBe(
      'Fixed costs come to $500 a month. Ticket sales and other show money count after 7 more days.',
    );
    expect(
      runwayHeadline(aCashRunway({ status: 'outOfCash', cash: -10, monthsLeft: null }), money),
    ).toBe(
      'You are out of cash. Costs are still paid, so the debt grows by about $4300000 a month.',
    );
  });

  it('warns only while money goes out faster than it comes in', () => {
    expect(runwayWarns(aCashRunway())).toBe(true);
    expect(runwayWarns(aCashRunway({ status: 'runningOut' }))).toBe(true);
    expect(runwayWarns(aCashRunway({ status: 'outOfCash' }))).toBe(true);
    expect(runwayWarns(aCashRunway({ status: 'makingMoney' }))).toBe(false);
    expect(runwayWarns(aCashRunway({ status: 'tooEarly' }))).toBe(false);
  });
});

describe('CashRunwayCardView', () => {
  it('shows the months left, the sentence, the month at this rate and the fixed spend, each with a Why?', () => {
    render(<CashRunwayCardView runway={aCashRunway()} />);
    const card = screen.getByRole('group', { name: 'Cash runway' });
    expect(within(card).getByText('8')).toBeInTheDocument();
    expect(within(card).getByText('Losing money')).toBeInTheDocument();
    expect(
      within(card).getByText('At this rate you run out of cash in about 8 months.'),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: /^Why is Months of cash left/u }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: /^Why is Money a month at this rate/u }),
    ).toBeInTheDocument();
    for (const line of ['Wages', 'Medical', 'Production overhead', 'Show production']) {
      expect(within(card).getByText(line)).toBeInTheDocument();
    }
    expect(card.textContent).not.toMatch(/minute|undefined|NaN/iu);
  });

  it('says when the forecast starts before a week of play', () => {
    render(
      <CashRunwayCardView
        runway={aCashRunway({
          status: 'tooEarly',
          monthsLeft: null,
          monthsLeftTrace: null,
          daysUntilForecast: 3,
        })}
      />,
    );
    const card = screen.getByRole('group', { name: 'Cash runway' });
    expect(within(card).getByText('After a week')).toBeInTheDocument();
    expect(within(card).getByText('Fixed costs a month')).toBeInTheDocument();
    expect(within(card).getByText(/count after 3 more days\.$/u)).toBeInTheDocument();
    expect(within(card).queryByText('Losing money')).toBeNull();
  });
});

describe('CashRunwayBannerView', () => {
  it('warns in words with a Why? while losing money', () => {
    render(
      <CashRunwayBannerView runway={aCashRunway({ status: 'runningOut', monthsLeft: 4.6 })} />,
    );
    const banner = screen.getByRole('region', { name: 'Cash warning' });
    expect(within(banner).getByText('Running out of cash')).toBeInTheDocument();
    expect(banner.textContent).toMatch(/run out of cash in about 5 months\. You lose about /u);
    expect(
      within(banner).getByRole('button', { name: /^Why is Months of cash left/u }),
    ).toBeInTheDocument();
  });

  it('draws nothing while making money or before a week of play', () => {
    const { container } = render(
      <>
        <CashRunwayBannerView runway={aCashRunway({ status: 'makingMoney', monthsLeft: null })} />
        <CashRunwayBannerView runway={aCashRunway({ status: 'tooEarly', monthsLeft: null })} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
