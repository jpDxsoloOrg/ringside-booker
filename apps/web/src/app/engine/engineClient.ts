/**
 * The engine client: what `EngineProvider` puts in context and the hooks use. It creates the
 * transport on first use, keeps the status store current (revision, busy, fatal, last error) and
 * owns the query cache.
 *
 * Rejected queries and commands are data: they resolve with `{ ok: false, reasons }`. Only
 * transport failures reject, including every call still waiting when the engine dies.
 */

import type {
  CommandArgs,
  CommandName,
  InspectReport,
  QueryArgs,
  QueryData,
  QueryName,
} from '@ringside/engine';
import type { AutosaveOptions } from '@/storage';
import type {
  AdvanceOutcome,
  AdvanceProgress,
  AdvanceRequest,
  HostCommandResponse,
  HostQueryResponse,
  LoadSaveResult,
  LoadSlotWhich,
  PingResult,
  SaveSlotResult,
  StartNewGameInput,
  StartNewGameResult,
  WorldPackList,
  WorldPreviewResult,
} from '@/worker/engineHost';
import type { LocalSeat } from '@/worker/localViewer';
import { createEngineStatusStore } from './engineStatusStore';
import type { EngineStatusState } from './engineStatusStore';
import { QueryCache, queryKey } from './queryCache';
import type { CacheEntry } from './queryCache';
import type { EngineHostClient, EngineTransport } from './transport';
import type { StoreApi } from 'zustand/vanilla';

/** A call that failed to get an answer from the engine at all. */
export class EngineTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EngineTransportError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class EngineClient {
  readonly status: StoreApi<EngineStatusState> = createEngineStatusStore();
  readonly cache: QueryCache = new QueryCache();
  readonly #createTransport: () => EngineTransport;
  #transport: EngineTransport | null = null;
  #stopListening: (() => void) | null = null;
  /** Rejects when the engine dies, so calls still waiting on it settle. */
  #fatalSignal: Promise<never> | null = null;

  constructor(createTransport: () => EngineTransport) {
    this.#createTransport = createTransport;
  }

  /** The transport, created on first use. */
  #connect(): EngineTransport {
    if (this.#transport !== null) return this.#transport;
    let transport: EngineTransport;
    try {
      transport = this.#createTransport();
    } catch (error: unknown) {
      const message = `The simulation could not start: ${errorMessage(error)}`;
      this.status.getState().setFatal({ message, stack: null });
      throw new EngineTransportError(message, { cause: error });
    }
    this.#transport = transport;
    this.#fatalSignal = new Promise<never>((_resolve, reject) => {
      this.#stopListening = transport.onFatal((fatal) => {
        this.status.getState().setFatal(fatal);
        reject(new EngineTransportError(`The simulation stopped: ${fatal.message}`));
      });
    });
    void this.#absorbFatalSignal(this.#fatalSignal);
    void this.#pingInBackground();
    return transport;
  }

  /** Nobody may be waiting when the engine dies; the status store carries the news then. */
  async #absorbFatalSignal(signal: Promise<never>): Promise<void> {
    try {
      await signal;
    } catch {
      // Reported through the status store.
    }
  }

  async #pingInBackground(): Promise<void> {
    try {
      const { engineVersion } = await this.ping();
      this.status.getState().setEngineVersion(engineVersion);
    } catch {
      // The fatal handler or the next call reports the failure.
    }
  }

  /** Runs one host call, rejecting with {@link EngineTransportError} when it gets no answer. */
  async #call<T>(run: (host: EngineHostClient) => Promise<T>): Promise<T> {
    const fatal = this.status.getState().fatal;
    if (fatal !== null) {
      throw new EngineTransportError(`The simulation stopped: ${fatal.message}`);
    }
    const transport = this.#connect();
    try {
      const pending = run(transport.host);
      const answer =
        this.#fatalSignal === null ? pending : Promise.race([pending, this.#fatalSignal]);
      return await answer;
    } catch (error: unknown) {
      const message = errorMessage(error);
      this.status.getState().setLastError(message);
      if (error instanceof EngineTransportError) throw error;
      throw new EngineTransportError(message, { cause: error });
    }
  }

  ping(): Promise<PingResult> {
    return this.#call((host) => host.ping());
  }

  async query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<HostQueryResponse<K>> {
    const status = this.status.getState();
    status.beginCall('query');
    try {
      const response = await this.#call((host) => host.query(name, args));
      this.status.getState().setRevision(response.revision);
      return response;
    } finally {
      this.status.getState().endCall('query');
    }
  }

  async command<K extends CommandName>(
    name: K,
    args: CommandArgs<K>,
  ): Promise<HostCommandResponse<K>> {
    this.status.getState().beginCall('command');
    try {
      const response = await this.#call((host) => host.command(name, args));
      this.status.getState().setRevision(response.revision);
      return response;
    } finally {
      this.status.getState().endCall('command');
    }
  }

  async advanceDays(
    request: AdvanceRequest,
    onProgress: (progress: AdvanceProgress) => void,
  ): Promise<AdvanceOutcome> {
    this.status.getState().setAdvancing(true);
    try {
      const outcome = await this.#call((host) =>
        host.advanceDays(request, (progress) => {
          this.status.getState().setRevision(progress.revision);
          onProgress(progress);
        }),
      );
      this.status.getState().setRevision(outcome.revision);
      return outcome;
    } finally {
      this.status.getState().setAdvancing(false);
    }
  }

  /** Asks the running advance to stop after the current day. */
  cancelAdvance(): void {
    const transport = this.#transport;
    if (transport === null || this.status.getState().fatal !== null) return;
    void (async () => {
      try {
        await transport.host.cancelAdvance();
      } catch (error: unknown) {
        this.status.getState().setLastError(errorMessage(error));
      }
    })();
  }

  /**
   * Loads a save slot into the engine. On success the revision moves on, so every cached query
   * from the previous game refetches. A save that will not load resolves with its stage and issues.
   */
  async loadFromSlot(slotId: string, which: LoadSlotWhich = 'latest'): Promise<LoadSaveResult> {
    const result = await this.#busyCall((host) => host.loadFromSlot(slotId, which));
    if (result.ok) {
      this.status.getState().setRevision(result.revision);
      this.cache.invalidateAll();
    }
    return result;
  }

  /** A manual save of the running game into its slot. Refusals resolve; they never throw. */
  async saveToSlot(slotId: string): Promise<SaveSlotResult> {
    return this.#busyCall((host) => host.saveToSlot(slotId));
  }

  /** Creates a new slot holding the running game. */
  async createSlot(label: string): Promise<SaveSlotResult> {
    return this.#busyCall((host) => host.createSlot(label));
  }

  /** Writes the running game as its slot's autosave. */
  async autosave(slotId: string, options: AutosaveOptions): Promise<SaveSlotResult> {
    return this.#busyCall((host) => host.autosave(slotId, options));
  }

  /** Reads a save's header in the engine without loading it, for importing a file. */
  inspectSave(bytes: Uint8Array): Promise<InspectReport> {
    return this.#call((host) => host.inspectSave(bytes));
  }

  /** The bundled world packs a new game can start from. */
  listWorldPacks(): Promise<WorldPackList> {
    return this.#call((host) => host.listWorldPacks());
  }

  /** What a world pack holds, for the new-game wizard. */
  previewWorld(rootPackId: string): Promise<WorldPreviewResult> {
    return this.#call((host) => host.previewWorld(rootPackId));
  }

  /**
   * Builds a new world in the engine and makes it the running game. On success the revision moves
   * on and every cached query from a previous game refetches; refusals resolve with the reasons.
   */
  async startNewGame(input: StartNewGameInput): Promise<StartNewGameResult> {
    const result = await this.#busyCall((host) => host.startNewGame(input));
    this.status.getState().setRevision(result.revision);
    if (result.ok) this.cache.invalidateAll();
    return result;
  }

  /** The local seat of the running game, or null when none is loaded. */
  async getSeat(): Promise<LocalSeat | null> {
    return this.#call(async (host) => host.getSeat());
  }

  /** Stops the running game and forgets every cached query. */
  async unloadWorld(): Promise<void> {
    const { revision } = await this.#call(async (host) => host.unloadWorld());
    this.status.getState().setRevision(revision);
    this.cache.invalidateAll();
  }

  /** A host call that counts as a command while it runs, so the status shows the engine busy. */
  async #busyCall<T>(run: (host: EngineHostClient) => Promise<T>): Promise<T> {
    this.status.getState().beginCall('command');
    try {
      return await this.#call(run);
    } finally {
      this.status.getState().endCall('command');
    }
  }

  /**
   * Fetches a query into the cache, sharing a request already on its way for the same key. Never
   * rejects: a refusal or a transport failure is stored as the entry's error.
   */
  fetchQuery<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<CacheEntry> {
    return this.cache.fetch(queryKey(name, args), async () => {
      try {
        const { revision, result } = await this.query(name, args);
        return result.ok
          ? { revision, outcome: { ok: true, data: result.data } }
          : {
              revision,
              outcome: { ok: false, error: { kind: 'rejected', reasons: result.reasons } },
            };
      } catch (error: unknown) {
        return {
          revision: this.status.getState().revision,
          outcome: { ok: false, error: { kind: 'transport', message: errorMessage(error) } },
        };
      }
    });
  }

  /** Dev and e2e builds: makes the engine die, to try the crash screen. */
  crashForTesting(): void {
    this.#connect().crashForTesting();
  }

  /**
   * Stops the engine and forgets the transport. A later call starts a new one, which keeps React's
   * development double-mount working.
   */
  dispose(): void {
    this.#stopListening?.();
    this.#stopListening = null;
    this.#transport?.terminate();
    this.#transport = null;
    this.#fatalSignal = null;
  }
}

/** The data type of a query's cache entry: the key names the query, so its data is QueryData<K>. */
export function entryData<K extends QueryName>(entry: CacheEntry): QueryData<K> | undefined {
  if (!entry.outcome.ok) return undefined;
  // Entries under a query's key only ever hold that query's data (see EngineClient.fetchQuery).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return entry.outcome.data as QueryData<K>;
}
