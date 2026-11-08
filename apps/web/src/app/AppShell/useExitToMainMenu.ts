import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from 'zustand';
import { useOptionalEngineClient } from '../engine/EngineProvider';
import { createEngineStatusStore } from '../engine/engineStatusStore';
import { routes } from '../routes';
import { useSessionStore } from '../session/sessionStore';

/** Read when there is no engine client (a shell rendered on its own in a test): never advancing. */
const IDLE_STATUS = createEngineStatusStore();

export interface ExitToMainMenu {
  /** Saves the game into its slot, stops it and goes to the title screen. */
  readonly exit: () => Promise<void>;
  /** True while the save runs. */
  readonly saving: boolean;
  /** True while days are advancing: leaving then would cut a day in half, so the item waits. */
  readonly blocked: boolean;
  /** Why the last attempt stopped, such as a full disk. The player stays in the game. */
  readonly error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * "Main menu": a manual save into the session's slot, then the world is unloaded, the session
 * cleared and the title screen shown. A save that fails keeps the player in the game with the
 * storage error, so nothing is lost. A world that was never saved to a slot (the dev helper's
 * faked world) just unloads.
 */
export function useExitToMainMenu(onLeave?: () => void): ExitToMainMenu {
  const client = useOptionalEngineClient();
  const navigate = useNavigate();
  const advancing = useStore(client?.status ?? IDLE_STATUS, (state) => state.advancing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exit = useCallback(async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      const { saveSlotId } = useSessionStore.getState();
      if (client !== null) {
        if (saveSlotId !== null) {
          const saved = await client.saveToSlot(saveSlotId);
          if (!saved.ok) {
            setError(`Couldn't save before leaving: ${saved.message}`);
            return;
          }
        }
        await client.unloadWorld();
      }
    } catch (thrown: unknown) {
      setError(`Couldn't save before leaving: ${errorMessage(thrown)}`);
      return;
    } finally {
      setSaving(false);
    }
    useSessionStore.getState().clear();
    onLeave?.();
    navigate(routes.title());
  }, [client, navigate, onLeave]);

  return { exit, saving, blocked: advancing, error };
}
