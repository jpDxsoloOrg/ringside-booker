/**
 * SAVE-01: the shell saves shortly after every command the engine accepts, against the fake engine
 * in process. The host's autosave is a spy, so the test sees each save without touching storage.
 */
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { fakeSlot } from '@/test/fakeStorage';
import type { SaveSlotResult } from '@/worker/engineHost';
import { EngineProvider, useEngineClient } from '../../engine/EngineProvider';
import { createInProcessTransport } from '../../engine/transport';
import { useSessionStore } from '../../session/sessionStore';
import type { AutosaveState } from './DayAdvanceProvider';
import { SAVE_AFTER_CHANGES_DELAY_MS } from './saveAfterChanges';
import { useSaveAfterCommands } from './useSaveAfterCommands';

const SLOT_ID = 'slot-1';

function setup(autosaveResult?: SaveSlotResult) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
  useSessionStore.getState().setLoaded({ saveSlotId: SLOT_ID, seat: install.seat });
  const autosaveSpy = vi
    .spyOn(transport.host, 'autosave')
    .mockResolvedValue(autosaveResult ?? { ok: true, slot: fakeSlot({ slotId: SLOT_ID }) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EngineProvider createTransport={() => transport}>{children}</EngineProvider>
  );
  const rendered = renderHook(
    () => {
      const client = useEngineClient();
      const [autosave, setAutosave] = useState<AutosaveState>({ kind: 'idle' });
      const unsaved = useSaveAfterCommands(client, setAutosave);
      return { client, autosave, unsaved };
    },
    { wrapper },
  );
  const increment = async (amount: number): Promise<void> => {
    await act(async () => {
      await rendered.result.current.client.command('counter.increment', { amount });
    });
  };
  const wait = async (ms: number): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  return {
    transport,
    autosaveSpy,
    result: rendered.result,
    unmount: rendered.unmount,
    increment,
    wait,
  };
}

describe('useSaveAfterCommands', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    useSessionStore.getState().clear();
  });

  it('saves the slot once, shortly after a burst of accepted commands', async () => {
    const { autosaveSpy, result, increment, wait } = setup();

    await increment(1);
    await increment(2);
    expect(result.current.unsaved).toBe(true);
    expect(autosaveSpy).not.toHaveBeenCalled();

    await wait(SAVE_AFTER_CHANGES_DELAY_MS);
    expect(autosaveSpy).toHaveBeenCalledTimes(1);
    expect(autosaveSpy).toHaveBeenCalledWith(SLOT_ID, { monthlyBackup: false });
    expect(result.current.unsaved).toBe(false);
    expect(result.current.autosave).toEqual({ kind: 'idle' });
  });

  it('does not save after a refused command', async () => {
    const { autosaveSpy, result, increment, wait } = setup();

    await increment(-1);
    await wait(SAVE_AFTER_CHANGES_DELAY_MS * 2);

    expect(autosaveSpy).not.toHaveBeenCalled();
    expect(result.current.unsaved).toBe(false);
  });

  it('saves straight away when the page is hidden', async () => {
    const { autosaveSpy, increment, wait } = setup();

    await increment(1);
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await Promise.resolve();
    });
    expect(autosaveSpy).toHaveBeenCalledTimes(1);

    await wait(SAVE_AFTER_CHANGES_DELAY_MS * 2);
    expect(autosaveSpy).toHaveBeenCalledTimes(1);
  });

  it('shows a failed save as the warning chip', async () => {
    const { result, increment, wait } = setup({
      ok: false,
      message: 'There is no room left for saves.',
      storageError: { code: 'quota', message: 'There is no room left for saves.' },
    });

    await increment(1);
    await wait(SAVE_AFTER_CHANGES_DELAY_MS);

    expect(result.current.autosave).toEqual({
      kind: 'failed',
      message: 'There is no room left for saves.',
      code: 'quota',
    });
  });

  it('drops the waiting save when the session leaves the game', async () => {
    const { autosaveSpy, result, increment, wait } = setup();

    await increment(1);
    act(() => {
      useSessionStore.getState().clear();
    });
    await wait(SAVE_AFTER_CHANGES_DELAY_MS * 2);

    expect(autosaveSpy).not.toHaveBeenCalled();
    expect(result.current.unsaved).toBe(false);
  });
});
