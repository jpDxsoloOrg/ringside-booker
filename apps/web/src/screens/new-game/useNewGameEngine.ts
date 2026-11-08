import { useCallback, useEffect, useState } from 'react';
import type {
  NewGameSummary,
  PackIssue,
  PackManifest,
  Reason,
  WorldPreview,
} from '@ringside/engine';
import { useOptionalEngineClient } from '@/app/engine/EngineProvider';
import { useSessionStore } from '@/app/session/sessionStore';
import type { StartNewGameInput } from '@/worker/engineHost';

/**
 * The wizard's link to the engine worker: the bundled world packs, the preview of the chosen one,
 * and starting the game. Every call runs in the worker, so the page keeps responding (and the busy
 * state keeps animating) while the world is built.
 *
 * Starting goes: `startNewGame` (the engine builds and installs the world) → `createSlot` (the
 * worker saves it into a new slot) → `getSeat` → the session store records the slot and the seat,
 * the same way loading a save does. The screen then navigates into the game.
 */

export type WorldListState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly packs: readonly PackManifest[];
      readonly issues: readonly PackIssue[];
    }
  | { readonly status: 'error'; readonly message: string };

export type PreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly rootPackId: string }
  | { readonly status: 'ready'; readonly rootPackId: string; readonly preview: WorldPreview }
  | {
      readonly status: 'failed';
      readonly rootPackId: string;
      readonly issues: readonly PackIssue[];
    }
  | { readonly status: 'error'; readonly rootPackId: string; readonly message: string };

/** What the busy state says while a game starts. */
export type StartPhase = 'creating' | 'saving';

export type StartOutcome =
  /** The game is running and saved; the session knows its slot and seat. */
  | { readonly kind: 'started'; readonly summary: NewGameSummary; readonly slotId: string }
  /** The engine refused the choices; nothing changed. */
  | { readonly kind: 'refused'; readonly reasons: readonly Reason[] }
  /** The game is running but could not be saved; `retrySave` tries again. */
  | { readonly kind: 'saveFailed'; readonly summary: NewGameSummary; readonly message: string }
  /** The engine did not answer, or answered with something unexpected. */
  | { readonly kind: 'error'; readonly message: string; readonly details: string };

export interface NewGameEngine {
  readonly worlds: WorldListState;
  /** The preview of the world asked for, or `idle` when none is. */
  readonly preview: PreviewState;
  /** Builds the world, saves it into a new slot and records the session. Never throws. */
  readonly start: (
    input: StartNewGameInput,
    onPhase: (phase: StartPhase) => void,
  ) => Promise<StartOutcome>;
  /** Saves a game that started but failed to save, then records the session. Never throws. */
  readonly retrySave: (summary: NewGameSummary) => Promise<StartOutcome>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

const NO_ENGINE_MESSAGE = 'The game engine is not running.';

/**
 * The engine side of the new-game wizard, for the world `rootPackId` (null before one is chosen).
 * Outside an `EngineProvider` every call reports that the engine is not running.
 */
export function useNewGameEngine(rootPackId: string | null): NewGameEngine {
  const client = useOptionalEngineClient();
  const [worlds, setWorlds] = useState<WorldListState>({ status: 'loading' });
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });

  useEffect(() => {
    let current = true;
    const loadWorlds = async (): Promise<void> => {
      if (client === null) {
        setWorlds({ status: 'error', message: NO_ENGINE_MESSAGE });
        return;
      }
      try {
        const list = await client.listWorldPacks();
        if (current) setWorlds({ status: 'ready', packs: list.packs, issues: list.issues });
      } catch (error: unknown) {
        if (current) setWorlds({ status: 'error', message: errorMessage(error) });
      }
    };
    void loadWorlds();
    return () => {
      current = false;
    };
  }, [client]);

  useEffect(() => {
    if (rootPackId === null) {
      setPreview({ status: 'idle' });
      return undefined;
    }
    let current = true;
    setPreview({ status: 'loading', rootPackId });
    const loadPreview = async (): Promise<void> => {
      if (client === null) {
        setPreview({ status: 'error', rootPackId, message: NO_ENGINE_MESSAGE });
        return;
      }
      try {
        const result = await client.previewWorld(rootPackId);
        if (!current) return;
        setPreview(
          result.ok
            ? { status: 'ready', rootPackId, preview: result.value }
            : { status: 'failed', rootPackId, issues: result.issues },
        );
      } catch (error: unknown) {
        if (current) setPreview({ status: 'error', rootPackId, message: errorMessage(error) });
      }
    };
    void loadPreview();
    return () => {
      current = false;
    };
  }, [client, rootPackId]);

  /** Saves the running game into a new slot named after the save and records the session. */
  const saveAndEnter = useCallback(
    async (summary: NewGameSummary): Promise<StartOutcome> => {
      if (client === null) {
        return { kind: 'error', message: NO_ENGINE_MESSAGE, details: NO_ENGINE_MESSAGE };
      }
      const saved = await client.createSlot(summary.saveName);
      if (!saved.ok) return { kind: 'saveFailed', summary, message: saved.message };
      const seat = await client.getSeat();
      if (seat === null) {
        const message = 'The new game stopped before it could be opened.';
        return { kind: 'error', message, details: message };
      }
      useSessionStore.getState().setLoaded({ saveSlotId: saved.slot.slotId, seat });
      return { kind: 'started', summary, slotId: saved.slot.slotId };
    },
    [client],
  );

  const start = useCallback(
    async (
      input: StartNewGameInput,
      onPhase: (phase: StartPhase) => void,
    ): Promise<StartOutcome> => {
      if (client === null) {
        return { kind: 'error', message: NO_ENGINE_MESSAGE, details: NO_ENGINE_MESSAGE };
      }
      try {
        onPhase('creating');
        const started = await client.startNewGame(input);
        if (!started.ok) return { kind: 'refused', reasons: started.reasons };
        onPhase('saving');
        return await saveAndEnter(started.summary);
      } catch (error: unknown) {
        return { kind: 'error', message: errorMessage(error), details: errorDetails(error) };
      }
    },
    [client, saveAndEnter],
  );

  const retrySave = useCallback(
    async (summary: NewGameSummary): Promise<StartOutcome> => {
      try {
        return await saveAndEnter(summary);
      } catch (error: unknown) {
        return { kind: 'error', message: errorMessage(error), details: errorDetails(error) };
      }
    },
    [saveAndEnter],
  );

  return { worlds, preview, start, retrySave };
}
