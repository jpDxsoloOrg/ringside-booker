import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';

/** What the engine is doing right now. An advance outranks commands, which outrank queries. */
export type EngineBusy = 'idle' | 'query' | 'command' | 'advancing';

/** Why the engine stopped for good. */
export interface EngineFatal {
  readonly message: string;
  readonly stack: string | null;
}

export interface EngineStatusState {
  /**
   * The newest world revision seen from the engine. It only goes up; a query cached at an older
   * revision is stale and refetches.
   */
  readonly revision: number;
  readonly busy: EngineBusy;
  /** Set once when the worker dies. The app then shows the "simulation stopped" screen. */
  readonly fatal: EngineFatal | null;
  /** The engine version the worker reported, once the transport has been pinged. */
  readonly engineVersion: string | null;
  /** The last transport failure, for a status line or a bug report. Rejected commands are not errors. */
  readonly lastError: string | null;
  readonly pendingQueries: number;
  readonly pendingCommands: number;
  readonly advancing: boolean;
  /** Raises `revision` to `revision` when it is newer. */
  readonly setRevision: (revision: number) => void;
  readonly beginCall: (kind: 'query' | 'command') => void;
  readonly endCall: (kind: 'query' | 'command') => void;
  readonly setAdvancing: (advancing: boolean) => void;
  readonly setFatal: (fatal: EngineFatal) => void;
  readonly setEngineVersion: (engineVersion: string) => void;
  readonly setLastError: (message: string | null) => void;
}

type BusyInputs = Pick<EngineStatusState, 'advancing' | 'pendingCommands' | 'pendingQueries'>;

function busyFrom({ advancing, pendingCommands, pendingQueries }: BusyInputs): EngineBusy {
  if (advancing) return 'advancing';
  if (pendingCommands > 0) return 'command';
  if (pendingQueries > 0) return 'query';
  return 'idle';
}

/** One store per engine client, so each test (and each app) starts from a clean slate. */
export function createEngineStatusStore(): StoreApi<EngineStatusState> {
  return createStore<EngineStatusState>()((set) => {
    const setCounts = (update: (state: EngineStatusState) => Partial<BusyInputs>): void => {
      set((state) => {
        const next = { ...state, ...update(state) };
        return { ...update(state), busy: busyFrom(next) };
      });
    };
    return {
      revision: 0,
      busy: 'idle',
      fatal: null,
      engineVersion: null,
      lastError: null,
      pendingQueries: 0,
      pendingCommands: 0,
      advancing: false,
      setRevision: (revision) => {
        set((state) => (revision > state.revision ? { revision } : state));
      },
      beginCall: (kind) => {
        setCounts((state) =>
          kind === 'query'
            ? { pendingQueries: state.pendingQueries + 1 }
            : { pendingCommands: state.pendingCommands + 1 },
        );
      },
      endCall: (kind) => {
        setCounts((state) =>
          kind === 'query'
            ? { pendingQueries: Math.max(0, state.pendingQueries - 1) }
            : { pendingCommands: Math.max(0, state.pendingCommands - 1) },
        );
      },
      setAdvancing: (advancing) => {
        setCounts(() => ({ advancing }));
      },
      setFatal: (fatal) => {
        set((state) => (state.fatal === null ? { fatal } : state));
      },
      setEngineVersion: (engineVersion) => {
        set({ engineVersion });
      },
      setLastError: (lastError) => {
        set({ lastError });
      },
    };
  });
}
