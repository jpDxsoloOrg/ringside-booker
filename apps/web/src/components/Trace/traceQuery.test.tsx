import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cents } from '@ringside/engine';
import type { PersonId } from '@ringside/engine';
import { tinyWorld } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { Explained } from './Explained';
import { useTracePanelStore } from './tracePanelStore';
import { traceQuery } from './traceSource';

/** The tiny world's free agent: its last person. */
function freeAgent(): PersonId {
  const personId = tinyWorld().ids.people.at(-1);
  if (personId === undefined) throw new Error('The tiny world lost its people.');
  return personId;
}

function engineWrapper() {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
  const asked: string[] = [];
  const { host } = transport;
  const runQuery = host.query.bind(host);
  host.query = async (name, args) => {
    asked.push(name);
    return runQuery(name, args);
  };
  function Wrapper({ children }: { children: ReactNode }) {
    return <EngineProvider createTransport={() => transport}>{children}</EngineProvider>;
  }
  return { Wrapper, asked, promotionId: install.seat.promotionId };
}

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

describe('Explained with a traceQuery (the lazy Why?)', () => {
  it('asks nothing until opened, then shows the trace picked out of the answer', async () => {
    const user = userEvent.setup({ delay: null });
    const { Wrapper, asked, promotionId } = engineWrapper();
    const personId = freeAgent();
    if (promotionId === null) throw new Error('The tiny world seats the player');
    render(
      <Wrapper>
        <Explained
          value={cents(650_000)}
          unit="money"
          label="Their ask"
          traceQuery={traceQuery(
            'contracts.askingTerms',
            { promotionId, personId },
            (ask) => ask.monthlyWage.trace,
          )}
        />
      </Wrapper>,
    );
    const button = screen.getByRole('button', { name: /^Why is Their ask/u });
    expect(asked).toEqual([]);
    await user.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Their ask' });
    expect(await within(dialog).findByRole('tree')).toBeInTheDocument();
    expect(asked).toEqual(['contracts.askingTerms']);
  });
});
