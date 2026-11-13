import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { TraceRef } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createTraceFixtureTransport } from '@/screens/dev-gallery/fixtures/traceEngine';
import { InjuryBanner, injuryWhatText, weeksOutText } from './InjuryBanner';

const CHANCE_REF: TraceRef = { kind: 'match.injuryChance', id: 'seg_aaaaaaaaaa:per_aaaaaaaaaa' };
const INJURY_REF: TraceRef = { kind: 'health.injury', id: 'inj_aaaaaaaaaa' };

function withEngine(ui: ReactNode) {
  return (
    <EngineProvider createTransport={() => createTraceFixtureTransport([])}>{ui}</EngineProvider>
  );
}

describe('InjuryBanner', () => {
  it('says Injured in words, with the worker, the injury, weeks out and both Why?s', () => {
    render(
      withEngine(
        <InjuryBanner
          name="Test Worker"
          bodyPart="legs"
          kindLabel="Sprained ankle"
          weeksOut={6}
          chance={0.042}
          chanceTraceRef={CHANCE_REF}
          injuryTraceRef={INJURY_REF}
        />,
      ),
    );
    const banner = screen.getByRole('region', { name: 'Injured: Test Worker' });
    expect(within(banner).getByText('Injured')).toBeInTheDocument();
    expect(within(banner).getByText('Sprained ankle (legs)')).toBeInTheDocument();
    expect(within(banner).getByText('Out about 6 weeks')).toBeInTheDocument();
    expect(within(banner).getByText('4.2%')).toBeInTheDocument();
    expect(within(banner).getAllByRole('button', { name: /^Why is/u })).toHaveLength(2);
  });

  it('leaves out a Why? whose trace is gone, and the chance when it is not kept', () => {
    render(
      withEngine(
        <InjuryBanner
          name="Test Worker"
          bodyPart="head"
          kindLabel="Concussion"
          weeksOut={1}
          chance={null}
          chanceTraceRef={null}
          injuryTraceRef={null}
        />,
      ),
    );
    expect(screen.getByText('Out about 1 week')).toBeInTheDocument();
    expect(screen.queryByText('Injury chance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('words weeks and the body part plainly', () => {
    expect(weeksOutText(1)).toBe('Out about 1 week');
    expect(weeksOutText(12)).toBe('Out about 12 weeks');
    expect(injuryWhatText('Torn bicep', 'arms')).toBe('Torn bicep (arms)');
  });
});
