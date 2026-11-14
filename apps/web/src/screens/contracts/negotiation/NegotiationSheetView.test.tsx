import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { useTracePanelStore } from '@/components/Trace';
import { createTraceFixtureTransport } from '@/screens/dev-gallery/fixtures/traceEngine';
import { NegotiationSheetView } from './NegotiationSheetView';
import type { NegotiationSheetViewProps } from './NegotiationSheetView';
import {
  aHistory,
  anAsk,
  aPreview,
  aStaticDraft,
  NEGOTIATION_ID,
  NEGOTIATION_PERSON,
} from './negotiationFixtures';
import { NOT_ENFORCED_TEXT } from './OfferForm';

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

const money = (amount: number): string => `$${(amount / 100).toLocaleString('en-US')}`;
const noop = (): void => undefined;

function props(overrides: Partial<NegotiationSheetViewProps> = {}): NegotiationSheetViewProps {
  return {
    open: true,
    onClose: noop,
    header: {
      personId: NEGOTIATION_PERSON,
      ringName: 'Rhea Vance',
      imageRef: null,
      roles: ['wrestler'],
      age: 29,
      situation: 'Free agent',
      currentDeal: null,
    },
    renewal: false,
    phase: 'new',
    statusText: null,
    draft: aStaticDraft(),
    ask: null,
    offerOnTable: null,
    roles: ['wrestler'],
    maxLengthMonths: 60,
    patience: { left: 3, start: 3 },
    bidders: ['Crown Pro', 'Lakeshore'],
    history: null,
    outcome: null,
    notice: null,
    errors: [],
    pending: false,
    money,
    actions: { onSubmit: noop, onAccept: noop, onRevise: noop, onEnd: noop, onWithdraw: noop },
    ...overrides,
  };
}

describe('NegotiationSheetView', () => {
  it('shows the ask beside the offer, the meter with its Why?, patience and bidders by name', () => {
    render(<NegotiationSheetView {...props()} />);
    const sheet = screen.getByRole('dialog', { name: 'Rhea Vance' });
    expect(within(sheet).getByRole('meter', { name: 'Their likely reaction' })).toHaveAttribute(
      'aria-valuetext',
      'Will counter, 62% of their ask',
    );
    expect(within(sheet).getByRole('button', { name: 'Why will counter?' })).toBeInTheDocument();
    expect(within(sheet).getByText('Patience: 3 of 3 rounds left')).toBeInTheDocument();
    expect(within(sheet).getByText('Also talking to: Crown Pro, Lakeshore')).toBeInTheDocument();
    expect(
      within(sheet).getByRole('button', { name: /^Why is Their monthly wage \$41,300/u }),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole('textbox', { name: 'Monthly wage' }),
    ).toHaveAccessibleDescription('They ask $41,300');
    expect(within(sheet).getByRole('button', { name: 'Submit offer' })).toBeEnabled();
  });

  it('says why a kind, exclusive or a perk cannot be offered', () => {
    const ask = anAsk({
      allowedKinds: [
        { kind: 'written', label: 'Written contract', allowed: true, reasons: [] },
        {
          kind: 'perAppearance',
          label: 'Per-appearance deal',
          allowed: false,
          reasons: [{ code: 'x', message: 'Not for a worker under contract with you' }],
        },
      ],
    });
    render(<NegotiationSheetView {...props({ draft: aStaticDraft({ ask }) })} />);
    expect(screen.getByRole('radio', { name: /Per-appearance deal/u })).toHaveAccessibleDescription(
      'Not for a worker under contract with you',
    );
    const exclusive = screen.getByRole('switch', { name: 'Exclusive' });
    expect(exclusive).toBeDisabled();
    expect(exclusive).toHaveAccessibleDescription(
      'Exclusive contracts need a reach of 35; yours is 12',
    );
    const control = screen.getByRole('switch', { name: 'Creative control' });
    expect(control).toBeDisabled();
    expect(control).toHaveAccessibleDescription(NOT_ENFORCED_TEXT);
  });

  it("puts a refusal's field reason under that field", () => {
    render(
      <NegotiationSheetView
        {...props({
          draft: aStaticDraft({ fieldErrors: { 'offer.terms.monthlyWage': 'Too low to be real' } }),
        })}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Monthly wage' })).toHaveAccessibleDescription(
      'They ask $41,300 Too low to be real',
    );
  });

  it('answers a counter with Accept, Revise or End, under the talks so far', () => {
    render(
      <EngineProvider createTransport={() => createTraceFixtureTransport([], 0)}>
        <NegotiationSheetView
          {...props({
            phase: 'countered',
            statusText: 'Countered: answer by Jan 14, 2027',
            history: { negotiationId: NEGOTIATION_ID, entries: aHistory() },
            draft: aStaticDraft({ preview: aPreview('likely', 1) }),
          })}
        />
      </EngineProvider>,
    );
    for (const name of ['Accept counter', 'Send revised offer', 'End talks']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    const talks = screen.getByRole('list', { name: 'Talks so far' });
    expect(within(talks).getByText('You offered $24,000 a month, 24 months')).toBeInTheDocument();
    expect(
      within(talks).getByText('They countered $34,200 a month, 24 months, Upper card'),
    ).toBeInTheDocument();
    expect(
      within(talks).getByRole('button', { name: 'Why this counter-offer in round 1?' }),
    ).toBeInTheDocument();
  });

  it('offers Withdraw while they think it over, and nothing once talks are closed', () => {
    const { rerender } = render(
      <NegotiationSheetView
        {...props({
          phase: 'awaitingReview',
          draft: null,
          ask: anAsk(),
          offerOnTable: '$34,200 a month, 24 months',
          statusText: 'Considering your offer: decides on Jan 8, 2027',
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Withdraw offer' })).toBeInTheDocument();
    expect(screen.getByText('Your offer: $34,200 a month, 24 months')).toBeInTheDocument();
    rerender(
      <NegotiationSheetView
        {...props({
          phase: 'closed',
          draft: null,
          ask: anAsk(),
          outcome: { text: 'Signed with Crown Pro instead', trace: null },
        })}
      />,
    );
    expect(screen.getByText('Signed with Crown Pro instead')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw|Submit|Accept/u })).toBeNull();
  });
});
