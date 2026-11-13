// The injury card (WRK6-05).
import { render as renderPlain, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { InjuryCard, injuryDaysLeftText } from './InjuryCard';
import type { InjuryCardInjury } from './InjuryCard';

const INJURY_ID = parseId('injury', 'inj_0000000001');

const OPEN: InjuryCardInjury = {
  label: 'Sprained ankle',
  bodyPart: 'legs',
  severity: 'minor',
  since: parseGameDate('2027-02-19'),
  expectedReturn: parseGameDate('2027-03-14'),
  returnedOn: null,
  daysOut: 23,
  daysRemaining: 9,
  canWorkAngles: true,
  source: 'segment',
  conditionLoss: 6,
  durationTraceRef: { kind: 'health.injury', id: INJURY_ID },
  conditionLossTraceRef: { kind: 'health.injuryConditionLoss', id: INJURY_ID },
  chanceTraceRef: { kind: 'health.injuryChance', id: INJURY_ID },
  pendingNotice: false,
};

const NO_TRACES: InjuryCardInjury = {
  ...OPEN,
  durationTraceRef: null,
  conditionLossTraceRef: null,
  chanceTraceRef: null,
};

/** A Why? by reference reads the engine when it opens, so the card needs a provider. */
function render(element: ReactElement) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  return renderPlain(<EngineProvider createTransport={() => transport}>{element}</EngineProvider>);
}

function card(): HTMLElement {
  return screen.getByRole('region', { name: /Sprained ankle/ });
}

describe('InjuryCard', () => {
  it('names the injury, the part, the severity in words and each row', () => {
    render(<InjuryCard injury={OPEN} />);
    const region = card();
    expect(within(region).getByRole('heading', { name: 'Sprained ankle' })).toBeInTheDocument();
    expect(within(region).getByText('Legs')).toBeInTheDocument();
    expect(within(region).getByText('Minor')).toBeInTheDocument();
    expect(within(region).queryByText(/^New/)).not.toBeInTheDocument();
    const rows = Object.fromEntries(
      within(region)
        .getAllByRole('term')
        .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(rows).toMatchObject({
      Since: 'Feb 19, 2027',
      'Back on': 'Mar 14, 2027',
      'Time out': '23 days',
      'Days left': '9 days',
      'Condition lost': '6',
      'Can work angles': 'Yes',
      'How it happened': 'In a match',
    });
  });

  it('gives a Why? to the time out, the condition lost and how it happened while kept', () => {
    render(<InjuryCard injury={OPEN} />);
    const region = card();
    expect(within(region).getByRole('button', { name: 'Why is Time out 23 days?' })).toBeVisible();
    expect(within(region).getByRole('button', { name: 'Why is Condition lost 6?' })).toBeVisible();
    expect(
      within(region).getByRole('button', { name: 'Why did Sprained ankle happen?' }),
    ).toBeVisible();
  });

  it('shows the numbers without a Why? once the breakdowns are gone', () => {
    render(<InjuryCard injury={NO_TRACES} />);
    const region = card();
    expect(within(region).queryAllByRole('button')).toEqual([]);
    expect(within(region).getByText('23 days')).toBeInTheDocument();
  });

  it('marks an injury the player has not seen as New, and a severe one in words', () => {
    render(<InjuryCard injury={{ ...OPEN, severity: 'severe', pendingNotice: true }} />);
    const region = card();
    expect(within(region).getByText('Severe')).toBeInTheDocument();
    // The badge says "New" on screen and what is new to a screen reader.
    expect(within(region).getByText(/^New/)).toHaveTextContent('New injury, not seen yet');
  });

  it('says Back tomorrow the day before the return and Back today on the day', () => {
    expect(injuryDaysLeftText(2)).toBe('2 days');
    expect(injuryDaysLeftText(1)).toBe('Back tomorrow');
    expect(injuryDaysLeftText(0)).toBe('Back today');
    render(<InjuryCard injury={{ ...OPEN, daysRemaining: 1 }} />);
    expect(within(card()).getByText('Back tomorrow')).toBeInTheDocument();
  });

  it('reads a healed injury as history: back on the day they returned, no days left', () => {
    render(
      <InjuryCard
        injury={{ ...NO_TRACES, returnedOn: parseGameDate('2027-03-12'), daysRemaining: null }}
      />,
    );
    const region = card();
    expect(within(region).getByText('Healed')).toBeInTheDocument();
    expect(within(region).getByText('Mar 12, 2027')).toBeInTheDocument();
    expect(within(region).queryByText('Days left')).not.toBeInTheDocument();
  });

  it('names the worker, as a button when it can open them, and leaves rows out when compact', async () => {
    const onOpenWorker = vi.fn();
    render(
      <InjuryCard injury={NO_TRACES} workerName="Kara Voss" onOpenWorker={onOpenWorker} compact />,
    );
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole('button', { name: 'Kara Voss' }));
    expect(onOpenWorker).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Can work angles')).not.toBeInTheDocument();
    expect(screen.queryByText('How it happened')).not.toBeInTheDocument();
  });
});
