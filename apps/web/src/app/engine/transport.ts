/**
 * How the main thread reaches the engine host: through a Web Worker in the app, or directly in
 * tests. Both give the same `host`, so hooks and screens never know which one they have.
 */

import * as Comlink from 'comlink';
import type {
  CommandArgs,
  CommandData,
  CommandName,
  CommandResult,
  InspectReport,
  QueryArgs,
  QueryData,
  QueryName,
  QueryResult,
} from '@ringside/engine';
import { createEngineHost } from '@/worker/engineHost';
import type {
  AdvanceOutcome,
  AdvanceProgress,
  AdvanceRequest,
  EngineFactory,
  EngineHostOptions,
  HostCommandResponse,
  HostQueryResponse,
  LoadSaveResult,
  LoadSlotWhich,
  PingResult,
  SaveSlotResult,
  UnloadResult,
  WorkerEngineHost,
} from '@/worker/engineHost';
import type { AutosaveOptions } from '@/storage';
import type { LocalSeat } from '@/worker/localViewer';
import {
  CRASH_FOR_TESTING_MESSAGE,
  ENGINE_CRASH_REQUEST_TYPE,
  isEngineFatalMessage,
} from '@/worker/workerMessages';
import type { EngineCrashRequest } from '@/worker/workerMessages';
import type { EngineFatal } from './engineStatusStore';

/**
 * The engine host as the main thread calls it. It is the worker's `EngineHost` with every answer
 * allowed to arrive later, which covers both the Comlink proxy and the host object itself.
 */
export interface EngineHostClient {
  ping(): Promise<PingResult>;
  query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<HostQueryResponse<K>>;
  command<K extends CommandName>(name: K, args: CommandArgs<K>): Promise<HostCommandResponse<K>>;
  advanceDays(
    request: AdvanceRequest,
    onProgress: (progress: AdvanceProgress) => void,
  ): Promise<AdvanceOutcome>;
  cancelAdvance(): void | Promise<void>;
  isWorldLoaded(): boolean | Promise<boolean>;
  getSeat(): LocalSeat | null | Promise<LocalSeat | null>;
  loadFromSlot(slotId: string, which: LoadSlotWhich): Promise<LoadSaveResult>;
  saveToSlot(slotId: string): Promise<SaveSlotResult>;
  createSlot(label: string): Promise<SaveSlotResult>;
  autosave(slotId: string, options: AutosaveOptions): Promise<SaveSlotResult>;
  inspectSave(bytes: Uint8Array): Promise<InspectReport>;
  unloadWorld(): UnloadResult | Promise<UnloadResult>;
}

export type FatalListener = (fatal: EngineFatal) => void;

export interface EngineTransport {
  readonly host: EngineHostClient;
  /** Calls `listener` once if the engine dies. Returns a function that removes the listener. */
  onFatal(listener: FatalListener): () => void;
  /** Stops the engine for good. Calls already on their way never answer. */
  terminate(): void;
  /** Dev and e2e builds: makes the engine die of an uncaught error, to try the crash screen. */
  crashForTesting(): void;
}

/**
 * The host's members as they travel through Comlink. Comlink's `Remote` type cannot carry a
 * generic method's type parameter, so the worker transport talks to this untyped shape and puts
 * the types back in one place, below.
 */
interface WireEngineHost {
  ping(): Promise<PingResult>;
  query(name: string, args: unknown): Promise<{ revision: number; result: QueryResult<unknown> }>;
  command(
    name: string,
    args: unknown,
  ): Promise<{ revision: number; result: CommandResult<unknown> }>;
  advanceDays(
    request: AdvanceRequest,
    onProgress: (progress: AdvanceProgress) => void,
  ): Promise<AdvanceOutcome>;
  cancelAdvance(): void;
  isWorldLoaded(): boolean;
  getSeat(): LocalSeat | null;
  loadFromSlot(slotId: string, which: LoadSlotWhich): Promise<LoadSaveResult>;
  saveToSlot(slotId: string): Promise<SaveSlotResult>;
  createSlot(label: string): Promise<SaveSlotResult>;
  autosave(slotId: string, options: AutosaveOptions): Promise<SaveSlotResult>;
  inspectSave(bytes: Uint8Array): Promise<InspectReport>;
  unloadWorld(): UnloadResult;
}

/** Keeps the fatal listeners and makes sure they hear about a death once. */
function createFatalChannel(onFirstFatal: () => void): {
  readonly report: (fatal: EngineFatal) => void;
  readonly subscribe: (listener: FatalListener) => () => void;
} {
  const listeners = new Set<FatalListener>();
  let reported: EngineFatal | null = null;
  return {
    report: (fatal) => {
      if (reported !== null) return;
      reported = fatal;
      onFirstFatal();
      for (const listener of [...listeners]) listener(fatal);
    },
    subscribe: (listener) => {
      if (reported !== null) {
        listener(reported);
        return () => undefined;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The engine in its Web Worker, the way the app runs it. */
export function createWorkerTransport(): EngineTransport {
  const worker = new Worker(new URL('../../worker/engine.worker.ts', import.meta.url), {
    type: 'module',
    name: 'engine',
  });
  const remote = Comlink.wrap<WireEngineHost>(worker);
  const fatalChannel = createFatalChannel(() => {
    worker.terminate();
  });

  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (isEngineFatalMessage(event.data)) {
      fatalChannel.report({ message: event.data.message, stack: event.data.stack });
    }
  });
  // A script that fails to load, or an error the worker's own handlers could not report.
  worker.addEventListener('error', (event: ErrorEvent) => {
    fatalChannel.report({
      message: event.message === '' ? 'The engine worker stopped unexpectedly' : event.message,
      stack: null,
    });
  });

  const host: EngineHostClient = {
    ping: () => remote.ping(),
    async query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<HostQueryResponse<K>> {
      const response = await remote.query(name, args);
      // The worker ran the query registered under `name`, so its data is QueryData<K>.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const result = response.result as QueryResult<QueryData<K>>;
      return { revision: response.revision, result };
    },
    async command<K extends CommandName>(
      name: K,
      args: CommandArgs<K>,
    ): Promise<HostCommandResponse<K>> {
      const response = await remote.command(name, args);
      // The worker ran the command registered under `name`, so its data is CommandData<K>.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const result = response.result as CommandResult<CommandData<K>>;
      return { revision: response.revision, result };
    },
    advanceDays: (request, onProgress) => remote.advanceDays(request, Comlink.proxy(onProgress)),
    cancelAdvance: () => remote.cancelAdvance(),
    isWorldLoaded: () => remote.isWorldLoaded(),
    getSeat: () => remote.getSeat(),
    loadFromSlot: (slotId, which) => remote.loadFromSlot(slotId, which),
    saveToSlot: (slotId) => remote.saveToSlot(slotId),
    createSlot: (label) => remote.createSlot(label),
    autosave: (slotId, options) => remote.autosave(slotId, options),
    // Copied, not transferred: the import keeps the bytes to store them once they pass.
    inspectSave: (bytes) => remote.inspectSave(bytes),
    unloadWorld: () => remote.unloadWorld(),
  };

  return {
    host,
    onFatal: fatalChannel.subscribe,
    terminate: () => {
      worker.terminate();
    },
    crashForTesting: () => {
      const request: EngineCrashRequest = { type: ENGINE_CRASH_REQUEST_TYPE };
      worker.postMessage(request);
    },
  };
}

/** The in-process transport: the host object itself, plus a way to fake a crash. */
export interface InProcessTransport extends EngineTransport {
  readonly host: WorkerEngineHost;
  /** Reports `fatal` as if the worker had died. */
  simulateFatal(fatal: EngineFatal): void;
}

/**
 * The engine host on the calling thread, with no worker: for Vitest, where hook tests run fast and
 * deterministically in jsdom. The worker path is covered by the Playwright engine-worker spec.
 */
export function createInProcessTransport(
  engineFactory: EngineFactory,
  options: EngineHostOptions = {},
): InProcessTransport {
  const host = createEngineHost(engineFactory, options);
  const fatalChannel = createFatalChannel(() => undefined);
  return {
    host,
    onFatal: fatalChannel.subscribe,
    terminate: () => undefined,
    crashForTesting: () => {
      fatalChannel.report({ message: CRASH_FOR_TESTING_MESSAGE, stack: null });
    },
    simulateFatal: fatalChannel.report,
  };
}
