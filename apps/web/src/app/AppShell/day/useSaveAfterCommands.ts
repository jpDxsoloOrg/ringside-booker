import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { EngineClient } from '../../engine/engineClient';
import { useSessionStore } from '../../session/sessionStore';
import type { AutosaveState } from './DayAdvanceProvider';
import { SaveAfterChanges } from './saveAfterChanges';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Saves the game into its slot's autosave shortly after every command the engine accepts
 * (SAVE-01), so booking work survives a refresh or a closed tab. The page can't finish a save as
 * it closes (the worker and IndexedDB go with it), so this saves after changes instead; hiding the
 * page (switching apps on a phone) saves straight away.
 *
 * The save runs in the background: the day buttons stay ready, and it waits while the engine is
 * advancing, loading or running another command. A save that fails shows the same warning chip as
 * an advance's autosave; one that works clears it. Returns true while changes are unsaved.
 */
export function useSaveAfterCommands(
  client: EngineClient,
  setAutosave: Dispatch<SetStateAction<AutosaveState>>,
): boolean {
  const [unsaved, setUnsaved] = useState(false);

  useEffect(() => {
    let active = true;
    const saver = new SaveAfterChanges({
      canSave: () => {
        const status = client.status.getState();
        return status.fatal === null && !status.advancing && status.pendingCommands === 0;
      },
      onPendingChange: (pending) => {
        if (active) setUnsaved(pending);
      },
      save: async () => {
        const slotId = useSessionStore.getState().saveSlotId;
        if (slotId === null) return;
        let failure: AutosaveState | null = null;
        try {
          const saved = await client.autosaveInBackground(slotId);
          if (!saved.ok) {
            failure = {
              kind: 'failed',
              message: saved.message,
              code: saved.storageError?.code ?? null,
            };
          }
        } catch (error: unknown) {
          failure = { kind: 'failed', message: errorMessage(error), code: null };
        }
        // The player left the game or loaded another while it saved: nothing to report.
        if (!active || useSessionStore.getState().saveSlotId !== slotId) return;
        if (failure === null) {
          setAutosave((current) => (current.kind === 'failed' ? { kind: 'idle' } : current));
        } else {
          setAutosave(failure);
        }
      },
    });

    const stopCommands = client.onCommandApplied(() => {
      saver.noteChange();
    });
    // Another game (or none) in the session: its changes are not this game's to save.
    let slotId = useSessionStore.getState().saveSlotId;
    const stopSession = useSessionStore.subscribe((state) => {
      if (state.saveSlotId === slotId) return;
      slotId = state.saveSlotId;
      saver.cancel();
    });
    const flush = (): void => {
      void saver.flush();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);

    return () => {
      active = false;
      stopCommands();
      stopSession();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      // Leaving the shell with a change still waiting saves it now rather than dropping it.
      void (async () => {
        await saver.flush();
        saver.dispose();
      })();
    };
  }, [client, setAutosave]);

  return unsaved;
}
