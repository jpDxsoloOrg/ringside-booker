import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { PersonId, PhysicalForSegmentResult, PhysicalWorkerRow } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { routerFutureFlags } from '@/app/router';
import { singlesWin } from '@/screens/dev-gallery/fixtures/segmentResults';
import { createTraceFixtureTransport } from '@/screens/dev-gallery/fixtures/traceEngine';
import { NOT_KEPT_TEXT, PhysicalMatch } from './PhysicalResults';

function withEngine(ui: ReactNode) {
  return (
    <EngineProvider createTransport={() => createTraceFixtureTransport([])}>
      <MemoryRouter future={routerFutureFlags}>{ui}</MemoryRouter>
    </EngineProvider>
  );
}

const ref = (kind: string) => ({ kind, id: 'seg_aaaaaaaaaa:per_aaaaaaaaaa' });

function row(overrides: Partial<PhysicalWorkerRow>): PhysicalWorkerRow {
  return {
    personId: 'per_aaaaaaaaaa' as PersonId,
    name: 'Test Worker',
    side: 0,
    fatigueGain: { value: 8.4, traceRef: ref('match.fatigue') },
    fatigueAfter: { value: 30.4, traceRef: ref('match.fatigue') },
    wearTotal: { value: 1.7, traceRef: ref('match.wear') },
    learning: { value: 0.0042, traceRef: ref('match.learning') },
    injuryChance: { value: 0.012, traceRef: ref('match.injuryChance') },
    injured: { value: false, traceRef: null },
    ...overrides,
  };
}

describe('PhysicalMatch', () => {
  it("shows a player's match with every number and its Why?, learning to three decimals", () => {
    const data: PhysicalForSegmentResult = { applied: true, workers: [row({})] };
    render(withEngine(<PhysicalMatch segment={singlesWin()} data={data} />));
    const worker = screen.getByRole('listitem');
    expect(within(worker).getByText('+8.4')).toBeInTheDocument();
    expect(within(worker).getByText('+0.004')).toBeInTheDocument();
    expect(within(worker).getByText('1.2%')).toBeInTheDocument();
    expect(within(worker).getAllByRole('button', { name: /^Why is/u })).toHaveLength(4);
    expect(within(worker).queryByText('Injured')).not.toBeInTheDocument();
  });

  it("marks a hurt worker and says what a rival show doesn't keep", () => {
    const data: PhysicalForSegmentResult = {
      applied: true,
      workers: [
        row({
          wearTotal: { value: null, traceRef: null },
          learning: { value: null, traceRef: null },
          injured: { value: true, traceRef: ref('match.injuryRoll') },
        }),
      ],
    };
    render(withEngine(<PhysicalMatch segment={singlesWin()} data={data} />));
    const worker = screen.getByRole('listitem');
    expect(within(worker).getByText('Injured')).toBeInTheDocument();
    expect(within(worker).getAllByText(NOT_KEPT_TEXT)).toHaveLength(2);
  });

  it('draws nothing for a match that has not run', () => {
    const { container } = render(
      withEngine(<PhysicalMatch segment={singlesWin()} data={{ applied: false, workers: [] }} />),
    );
    expect(container.querySelector('section')).toBeNull();
  });
});
