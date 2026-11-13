import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialEngineState } from '@ringside/engine';
import type { EngineState } from '@ringside/engine';
import { worldBuilder } from '@ringside/engine/testing';
import {
  FAKE_GATE_ID,
  FAKE_START_DATE,
  fakeEngineFactory,
  fakeEngineState,
} from '@/test/fakeEngine';
import type { FakeEngineOptions } from '@/test/fakeEngine';
import { EngineProvider } from '../../engine/EngineProvider';
import { createInProcessTransport } from '../../engine/transport';
import { useShellStatus } from './useShellStatus';

/** A world where no human runs anything: the local seat is an observer with no promotion. */
function observerState(): EngineState {
  const built = worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'Computer Promotion' }, (promotion) => promotion.withBrand())
    .build();
  return initialEngineState(built.world);
}

function setup(state: EngineState, fake: FakeEngineOptions = {}) {
  const transport = createInProcessTransport(fakeEngineFactory(fake), { progressIntervalMs: 0 });
  transport.host.installEngine(state);
  const querySpy = vi.spyOn(transport.host, 'query');
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(EngineProvider, { createTransport: () => transport, children });
  return { transport, querySpy, wrapper };
}

describe('useShellStatus', () => {
  it('reads the date, the season and the seat promotion from sim.status', async () => {
    const { wrapper } = setup(fakeEngineState());
    const { result } = renderHook(() => useShellStatus(), { wrapper });

    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    const { status } = result.current;
    expect(status?.date).toBe(FAKE_START_DATE);
    expect(status?.season?.number).toBe(2);
    expect(status?.promotion?.name).toBe('Test Promotion A');
    expect(typeof status?.promotion?.cash).toBe('number');
    expect(result.current.gates).toEqual([]);
  });

  it('gives a viewer with no promotion null cash and popularity', async () => {
    const { wrapper } = setup(observerState());
    const { result } = renderHook(() => useShellStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBeDefined();
    });
    expect(result.current.status?.promotion).toBeNull();
    expect(result.current.gates).toEqual([]);
  });

  it('lists a gate that hits today', async () => {
    const { wrapper } = setup(fakeEngineState(), {
      gateDate: FAKE_START_DATE,
      gateHit: { reason: 'Tonight: Harbor Lights Showdown', actionHint: 'showNight' },
    });
    const { result } = renderHook(() => useShellStatus(), { wrapper });

    await waitFor(() => {
      expect(result.current.gates).toHaveLength(1);
    });
    expect(result.current.gates[0]).toEqual({
      gateId: FAKE_GATE_ID,
      reason: 'Tonight: Harbor Lights Showdown',
      actionHint: 'showNight',
    });
  });

  it('passes no viewer: both queries go out with empty arguments', async () => {
    const { wrapper, querySpy } = setup(fakeEngineState());
    const { result } = renderHook(() => useShellStatus(), { wrapper });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const calls = querySpy.mock.calls.filter(([name]) => name.startsWith('sim.'));
    expect(calls.map(([name]) => name).sort()).toEqual(['sim.pendingGates', 'sim.status']);
    for (const [, args] of calls) expect(args).toEqual({});
  });
});
