import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOptionalEngineClient } from '@/app/engine/EngineProvider';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import type { LoadSaveFailure, LoadSlotWhich } from '@/worker/engineHost';

/** The load that is running: which slot, and which save in it. */
export interface PendingLoad {
  readonly slotId: string;
  readonly which: LoadSlotWhich;
}

export interface LoadGame {
  /**
   * Loads a save in the engine worker and, when it passes every check, enters the game at the
   * office. Resolves with the failure (stage and issues) when it does not load; never throws.
   */
  readonly loadSlot: (slotId: string, which?: LoadSlotWhich) => Promise<LoadSaveFailure | null>;
  /** The load in progress, or null. */
  readonly pending: PendingLoad | null;
}

/** A failure for a load that never reached the engine. */
function engineUnavailable(message: string): LoadSaveFailure {
  return {
    ok: false,
    stage: 'build',
    issues: [{ path: '', message }],
    truncated: 0,
    storageError: null,
    compat: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The load flow every load button shares (a slot card, a backup, Continue on the title screen).
 * On success it records the slot and the seat in the session, queues the one-time notice about
 * upgrades and warnings for the shell, and navigates to the office.
 */
export function useLoadGame(): LoadGame {
  const client = useOptionalEngineClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingLoad | null>(null);
  // A load that succeeds navigates away, so this hook's screen has often unmounted by the time the
  // load settles; its pending state is then left alone.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadSlot = useCallback(
    async (slotId: string, which: LoadSlotWhich = 'latest'): Promise<LoadSaveFailure | null> => {
      if (client === null) return engineUnavailable('The game engine is not running.');
      setPending({ slotId, which });
      try {
        const result = await client.loadFromSlot(slotId, which);
        if (!result.ok) return result;
        const session = useSessionStore.getState();
        session.setLoaded({ saveSlotId: slotId, seat: result.summary.seat });
        const upgrades = result.summary.migrationsApplied.map((migration) => migration.title);
        if (upgrades.length > 0 || result.warnings.length > 0) {
          session.showLoadNotice({ upgrades, warnings: result.warnings });
        }
        navigate(routes.game.office());
        return null;
      } catch (error: unknown) {
        return engineUnavailable(`The game engine did not answer: ${errorMessage(error)}`);
      } finally {
        if (mounted.current) setPending(null);
      }
    },
    [client, navigate],
  );

  return { loadSlot, pending };
}
