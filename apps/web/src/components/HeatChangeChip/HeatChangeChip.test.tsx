import { render as renderPlain, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { HeatChangeChip } from './HeatChangeChip';

/** A Why? by reference reads the engine when it opens, so the chip needs a provider. */
function render(chip: ReactElement) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  return renderPlain(<EngineProvider createTransport={() => transport}>{chip}</EngineProvider>);
}

const REF = { kind: 'storylines.heatStep', id: 'sty_0000000001/seg_0000000001' } as const;

describe('HeatChangeChip', () => {
  it('reads "<name> 54 → 62" with a +8 chip and a Why? on the new heat', () => {
    const { container } = render(
      <HeatChangeChip storylineName="Ashfall Rivalry" before={54} after={62} traceRef={REF} />,
    );
    expect(container).toHaveTextContent('Ashfall Rivalry54→to62');
    expect(screen.getByText('+8')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Why is Heat after this segment 62?' }),
    ).toBeInTheDocument();
  });

  it('works out the change from the whole numbers it shows', () => {
    render(<HeatChangeChip storylineName="Feud" before={65.6} after={58.2} traceRef={REF} />);
    expect(screen.getByText('66')).toBeInTheDocument();
    expect(screen.getByText('−8')).toBeInTheDocument();
  });

  it('says "(no change)" for a step that left the heat where it was, and has no Why? without a trace', () => {
    render(<HeatChangeChip storylineName="Feud" before={54} after={54} traceRef={null} />);
    expect(screen.getByText('(no change)')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks the finale', () => {
    render(<HeatChangeChip storylineName="Feud" before={70} after={80} traceRef={null} finale />);
    expect(screen.getByText('Finale')).toBeInTheDocument();
  });
});
