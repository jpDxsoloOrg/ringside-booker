import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { EmploymentId, PersonId } from '@ringside/engine';
import { tinyWorld } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { attendanceTrace } from '@/screens/dev-gallery/fixtures/traces';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { LazyWhyButton } from './LazyWhyButton';
import { NO_BREAKDOWN_TEXT } from './TracePanel';
import { useTracePanelStore } from './tracePanelStore';
import { WhyButton } from './WhyButton';

function firstPerson(): PersonId {
  const personId = tinyWorld().ids.people[0];
  if (personId === undefined) throw new Error('The tiny world lost its people.');
  return personId;
}

/** An in-process engine over the tiny world, with every query it is asked recorded by name. */
function engineWrapper() {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  transport.host.installEngine(fakeEngineState());
  const asked: string[] = [];
  const { host } = transport;
  const runQuery = host.query.bind(host);
  host.query = async (name, args) => {
    asked.push(name);
    return runQuery(name, args);
  };
  function EngineWrapper({ children }: { children: ReactNode }) {
    return <EngineProvider createTransport={() => transport}>{children}</EngineProvider>;
  }
  /** The first contract on the seat's roster. */
  const firstContract = async (): Promise<EmploymentId> => {
    const answer = await runQuery('roster.rows', {});
    const row = answer.result.ok ? answer.result.data.rows[0] : undefined;
    if (row === undefined) throw new Error('The tiny world has no roster.');
    return row.employmentId;
  };
  return { Wrapper: EngineWrapper, asked, firstContract };
}

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

describe('LazyWhyButton', () => {
  it('asks the engine nothing until it is opened, then shows the breakdown', async () => {
    const user = userEvent.setup();
    const { Wrapper, asked } = engineWrapper();
    render(
      <Wrapper>
        <LazyWhyButton
          label="Overall"
          value={50}
          queryName="workers.explain"
          args={{ personId: firstPerson(), metric: 'overall' }}
        />
      </Wrapper>,
    );
    const button = screen.getByRole('button', { name: 'Why is Overall 50?' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(asked).toEqual([]);

    await user.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Overall' });
    expect(await within(dialog).findByRole('tree')).toBeInTheDocument();
    expect(within(dialog).getByText('Wrestler rating')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy as text' })).toBeInTheDocument();
    expect(asked).toEqual(['workers.explain']);

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(button).toHaveFocus();
  });

  it('says so when the engine refuses', async () => {
    const user = userEvent.setup();
    const { Wrapper } = engineWrapper();
    render(
      <Wrapper>
        <LazyWhyButton
          label="Overall"
          value={50}
          queryName="workers.explain"
          args={{ personId: parseId('person', 'per_zzzzzzzzzz'), metric: 'overall' }}
        />
      </Wrapper>,
    );
    await user.click(screen.getByRole('button', { name: 'Why is Overall 50?' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The breakdown could not be loaded. No such worker');
  });

  it('explains a roster number, built on demand', async () => {
    const user = userEvent.setup({ delay: null });
    const { Wrapper, asked, firstContract } = engineWrapper();
    const employmentId = await firstContract();
    asked.length = 0;
    render(
      <Wrapper>
        <LazyWhyButton
          label="Popularity"
          value={12}
          queryName="roster.explain"
          args={{ employmentId, metric: 'popularity' }}
        />
      </Wrapper>,
    );
    expect(asked).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Why is Popularity 12?' }));
    const dialog = screen.getByRole('dialog', { name: 'Popularity' });
    expect(await within(dialog).findByRole('tree')).toBeInTheDocument();
    expect(asked).toEqual(['roster.explain']);
  });

  it('says there is no breakdown when the query answers null', async () => {
    const user = userEvent.setup({ delay: null });
    const { Wrapper } = engineWrapper();
    render(
      <Wrapper>
        <LazyWhyButton
          label="Expects"
          value="Mid card"
          queryName="roster.explain"
          args={{ employmentId: parseId('employment', 'emp_zzzzzzzzzz'), metric: 'pushGap' }}
        />
      </Wrapper>,
    );
    await user.click(screen.getByRole('button', { name: 'Why is Expects Mid card?' }));
    const dialog = screen.getByRole('dialog', { name: 'Expects' });
    expect(await within(dialog).findByText(NO_BREAKDOWN_TEXT)).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('shares the one open panel with WhyButton', async () => {
    const user = userEvent.setup();
    const { Wrapper } = engineWrapper();
    render(
      <Wrapper>
        <WhyButton label="Attendance" value={9000} source={{ trace: attendanceTrace }} />
        <LazyWhyButton
          label="Top popularity"
          value={12}
          queryName="workers.explain"
          args={{ personId: firstPerson(), metric: 'topPopularity' }}
        />
      </Wrapper>,
    );
    await user.click(screen.getByRole('button', { name: 'Why is Top popularity 12?' }));
    expect(screen.getByRole('dialog', { name: 'Top popularity' })).toBeInTheDocument();
    const lazyPanelId = useTracePanelStore.getState().openPanelId;

    act(() => {
      useTracePanelStore.getState().openPanel('another-panel');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Top popularity' })).toBeNull();
    });
    expect(useTracePanelStore.getState().openPanelId).not.toBe(lazyPanelId);
  });
});
