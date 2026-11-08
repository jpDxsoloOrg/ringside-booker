import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TEST_PLAYER_ID } from '@ringside/engine/testing';
import {
  FAKE_GATE_ID,
  fakeAdvanceDay,
  fakeEngineFactory,
  fakeEngineState,
} from '@/test/fakeEngine';
import type { FakeEngineOptions } from '@/test/fakeEngine';
import type { AdvanceOutcome } from '@/worker/engineHost';
import { EngineTransportError } from './engineClient';
import { EngineProvider, useEngineClient, useEngineStatus } from './EngineProvider';
import { createInProcessTransport } from './transport';
import { useAdvanceDays } from './useAdvanceDays';
import { useEngineCommand } from './useEngineCommand';
import { useEngineQuery } from './useEngineQuery';
import type { EngineQueryState } from './useEngineQuery';

interface SetupOptions {
  readonly fake?: FakeEngineOptions;
  /** Install the fake world before the test renders. Defaults to true. */
  readonly loadWorld?: boolean;
}

function setup({ fake = {}, loadWorld = true }: SetupOptions = {}) {
  const transport = createInProcessTransport(fakeEngineFactory(fake), { progressIntervalMs: 0 });
  if (loadWorld) transport.host.installEngine(fakeEngineState());
  const querySpy = vi.spyOn(transport.host, 'query');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EngineProvider createTransport={() => transport}>{children}</EngineProvider>
  );
  return { transport, querySpy, wrapper };
}

function querySpyCalls(spy: ReturnType<typeof setup>['querySpy'], name: string): number {
  return spy.mock.calls.filter(([calledName]) => calledName === name).length;
}

describe('useEngineQuery', () => {
  it('loads a query result', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useEngineQuery('counter.get', {}), { wrapper });

    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.data).toEqual({ value: 0 });
    expect(result.current.error).toBeNull();
    expect(result.current.revision).toBe(1);
    expect(result.current.isStale).toBe(false);
  });

  it('serves a second identical query from the cache', async () => {
    const { wrapper, querySpy } = setup();
    const { result, rerender } = renderHook(
      ({ showSecond }: { showSecond: boolean }) => ({
        first: useEngineQuery('counter.get', {}),
        second: useEngineQuery('counter.get', {}, { enabled: showSecond }),
      }),
      { wrapper, initialProps: { showSecond: false } },
    );
    await waitFor(() => {
      expect(result.current.first.status).toBe('success');
    });

    rerender({ showSecond: true });
    expect(result.current.second).toMatchObject({ status: 'success', data: { value: 0 } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(querySpyCalls(querySpy, 'counter.get')).toBe(1);
  });

  it('shares one cache between the components under a provider', async () => {
    const { wrapper, querySpy } = setup();
    const { result } = renderHook(
      () => ({
        first: useEngineQuery('counter.get', {}),
        second: useEngineQuery('counter.get', {}),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.second.status).toBe('success');
    });
    expect(result.current.first.data).toEqual({ value: 0 });
    expect(querySpyCalls(querySpy, 'counter.get')).toBe(1);
  });

  it('reports the noWorld reason when no game is loaded', async () => {
    const { wrapper } = setup({ loadWorld: false });
    const { result } = renderHook(() => useEngineQuery('counter.get', {}), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toEqual({
      kind: 'rejected',
      reasons: [{ code: 'noWorld', message: 'No game is loaded' }],
    });
  });

  it('waits while disabled', async () => {
    const { wrapper, querySpy } = setup();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useEngineQuery('counter.get', {}, { enabled }),
      { wrapper, initialProps: { enabled: false } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe('loading');
    expect(querySpy).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
  });

  it('keeps the previous data, marked stale, when the arguments change', async () => {
    const { wrapper } = setup();
    const seen: EngineQueryState<'sim.commandLog'>[] = [];
    const { result, rerender } = renderHook(
      ({ limit }: { limit: number }) => {
        const state = useEngineQuery('sim.commandLog', { limit });
        seen.push(state);
        return state;
      },
      { wrapper, initialProps: { limit: 1 } },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    const firstData = result.current.data;

    rerender({ limit: 2 });
    expect(result.current.status).toBe('success');
    expect(result.current.isStale).toBe(true);
    expect(result.current.data).toBe(firstData);
    await waitFor(() => {
      expect(result.current.isStale).toBe(false);
    });
  });
});

describe('useEngineCommand', () => {
  it('bumps the revision and the mounted query refetches, keeping old data meanwhile', async () => {
    const { wrapper, querySpy } = setup();
    const seen: EngineQueryState<'counter.get'>[] = [];
    const { result } = renderHook(
      () => {
        const counter = useEngineQuery('counter.get', {});
        seen.push(counter);
        return {
          counter,
          increment: useEngineCommand('counter.increment'),
          revision: useEngineStatus((state) => state.revision),
        };
      },
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.counter.status).toBe('success');
    });

    let commandResult: unknown;
    await act(async () => {
      commandResult = await result.current.increment.run({ amount: 2 });
    });
    expect(commandResult).toMatchObject({ ok: true, data: { value: 2 } });
    expect(result.current.revision).toBe(2);
    await waitFor(() => {
      expect(result.current.counter.data).toEqual({ value: 2 });
    });
    expect(result.current.counter.revision).toBe(2);
    expect(result.current.increment.lastResult).toMatchObject({ ok: true });
    expect(result.current.increment.pending).toBe(false);
    expect(querySpyCalls(querySpy, 'counter.get')).toBe(2);
    // Between the command and the refetch, the old value stayed on screen as stale.
    expect(seen).toContainEqual(
      expect.objectContaining({ status: 'success', data: { value: 0 }, isStale: true }),
    );
  });

  it('resolves a refused command with its reasons and leaves the revision alone', async () => {
    const { wrapper, querySpy } = setup();
    const { result } = renderHook(
      () => ({
        counter: useEngineQuery('counter.get', {}),
        increment: useEngineCommand('counter.increment'),
        revision: useEngineStatus((state) => state.revision),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.counter.status).toBe('success');
    });

    let commandResult: unknown;
    await act(async () => {
      commandResult = await result.current.increment.run({ amount: -1 });
    });
    expect(commandResult).toEqual({
      ok: false,
      reasons: [{ code: 'negativeAmount', message: 'The counter only goes up.', field: 'amount' }],
    });
    expect(result.current.increment.lastResult).toEqual(commandResult);
    expect(result.current.revision).toBe(1);
    expect(querySpyCalls(querySpy, 'counter.get')).toBe(1);
  });

  it('issues commands as the local controller without being told who', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        increment: useEngineCommand('counter.increment'),
        log: useEngineQuery('sim.commandLog', { limit: 5 }),
      }),
      { wrapper },
    );
    await act(async () => {
      await result.current.increment.run({ amount: 1 });
    });
    await waitFor(() => {
      expect(result.current.log.data).toHaveLength(1);
    });
    expect(result.current.log.data?.[0]?.issuedBy).toEqual({
      kind: 'human',
      playerId: TEST_PLAYER_ID,
    });
  });

  it('throws only for transport failures', async () => {
    const { wrapper, transport } = setup();
    const { result } = renderHook(() => useEngineClient(), { wrapper });
    await act(async () => {
      await result.current.ping();
    });
    const client = result.current;
    act(() => {
      transport.simulateFatal({ message: 'Worker gone', stack: null });
    });
    await expect(client.command('counter.increment', { amount: 1 })).rejects.toBeInstanceOf(
      EngineTransportError,
    );
  });
});

describe('useAdvanceDays', () => {
  it('reports progress, marks the engine busy and stops at the gate', async () => {
    const { wrapper } = setup({ fake: { gateDate: fakeAdvanceDay(3) } });
    const { result } = renderHook(
      () => ({
        advance: useAdvanceDays(),
        busy: useEngineStatus((state) => state.busy),
        client: useEngineClient(),
      }),
      { wrapper },
    );
    const busyStates = new Set<string>();
    const stopWatching = result.current.client.status.subscribe((state) => {
      busyStates.add(state.busy);
    });

    let outcome: AdvanceOutcome | undefined;
    await act(async () => {
      outcome = await result.current.advance.start({ maxDays: 10 });
    });
    expect(outcome).toMatchObject({
      ok: true,
      daysAdvanced: 2,
      stoppedBy: { kind: 'gate', hits: [{ gateId: FAKE_GATE_ID }] },
    });
    expect(result.current.advance.progress).toEqual({
      daysDone: 2,
      daysRequested: 10,
      currentDate: fakeAdvanceDay(3),
      revision: 3,
    });
    expect(result.current.advance.running).toBe(false);
    stopWatching();
    expect(busyStates).toContain('advancing');
    expect(result.current.busy).toBe('idle');
  });

  it('cancels after the current day', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdvanceDays(), { wrapper });

    let running: Promise<AdvanceOutcome> | undefined;
    act(() => {
      running = result.current.start({ maxDays: 3650 });
    });
    await waitFor(() => {
      expect(result.current.running).toBe(true);
      expect(result.current.progress?.daysDone ?? 0).toBeGreaterThanOrEqual(1);
    });
    act(() => {
      result.current.cancel();
    });
    let outcome: AdvanceOutcome | undefined;
    await act(async () => {
      outcome = await running;
    });

    expect(outcome).toMatchObject({ ok: true, stoppedBy: { kind: 'cancelled' } });
    if (outcome?.ok !== true) return;
    expect(outcome.daysAdvanced).toBeLessThan(3650);
    expect(result.current.running).toBe(false);
  });

  it('refetches mounted queries as days pass', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({ clock: useEngineQuery('clock.get', {}), advance: useAdvanceDays() }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.clock.status).toBe('success');
    });
    await act(async () => {
      await result.current.advance.start({ maxDays: 3 });
    });
    await waitFor(() => {
      expect(result.current.clock.data?.date).toBe(fakeAdvanceDay(4));
    });
  });
});

describe('EngineProvider when the engine dies', () => {
  function QueryProbe() {
    const counter = useEngineQuery('counter.get', {});
    return <p>Counter: {counter.status}</p>;
  }

  it('shows the simulation-stopped screen in place of its children', async () => {
    const { transport } = setup();
    render(
      <EngineProvider createTransport={() => transport}>
        <QueryProbe />
      </EngineProvider>,
    );
    await screen.findByText('Counter: success');

    act(() => {
      transport.simulateFatal({
        message: 'Out of memory',
        stack: 'Error: Out of memory\n  at day',
      });
    });

    expect(screen.getByRole('heading', { level: 1, name: 'The simulation stopped' })).toHaveFocus();
    expect(screen.queryByText('Counter: success')).not.toBeInTheDocument();
    expect(screen.getByText(/last autosave is intact/)).toBeInTheDocument();
    expect(screen.getByText('Error details')).toBeInTheDocument();
    expect(screen.getByText(/Error: Out of memory/, { selector: 'pre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('copies the error details to the clipboard', async () => {
    const user = userEvent.setup();
    const { transport } = setup();
    render(
      <EngineProvider createTransport={() => transport}>
        <QueryProbe />
      </EngineProvider>,
    );
    await screen.findByText('Counter: success');
    act(() => {
      transport.simulateFatal({ message: 'Out of memory', stack: null });
    });

    await user.click(screen.getByRole('button', { name: 'Copy error details' }));
    await expect(navigator.clipboard.readText()).resolves.toContain('Error: Out of memory');
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });
});
