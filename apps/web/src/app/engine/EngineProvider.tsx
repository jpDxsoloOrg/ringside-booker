import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { EngineStoppedScreen } from '@/screens/engine-stopped/EngineStoppedScreen';
import { EngineClient } from './engineClient';
import type { EngineStatusState } from './engineStatusStore';
import { createWorkerTransport } from './transport';
import type { EngineTransport } from './transport';

const EngineClientContext = createContext<EngineClient | null>(null);

export interface EngineProviderProps {
  /** Builds the transport on first use. The app runs the engine in its Web Worker; tests pass an in-process one. */
  readonly createTransport?: () => EngineTransport;
  readonly children: ReactNode;
}

/**
 * Gives everything below it the engine client. The engine itself starts on the first query,
 * command or ping. If the engine dies, the children are replaced by the "simulation stopped"
 * screen, because nothing below can work without it.
 *
 * The client lives as long as the page. It is not disposed on unmount: React's development
 * double-mount would otherwise stop the worker under requests that are still on their way.
 */
export function EngineProvider({
  createTransport = createWorkerTransport,
  children,
}: EngineProviderProps) {
  const [client] = useState(() => new EngineClient(createTransport));
  const fatal = useStore(client.status, (state) => state.fatal);

  if (fatal !== null) {
    return <EngineStoppedScreen fatal={fatal} />;
  }
  return <EngineClientContext.Provider value={client}>{children}</EngineClientContext.Provider>;
}

/** The engine client. Throws when there is no `EngineProvider` above the caller. */
export function useEngineClient(): EngineClient {
  const client = useContext(EngineClientContext);
  if (client === null) {
    throw new Error('useEngineClient: wrap the app in <EngineProvider>.');
  }
  return client;
}

/** The engine client, or null outside an `EngineProvider` (a component rendered on its own in a test). */
export function useOptionalEngineClient(): EngineClient | null {
  return useContext(EngineClientContext);
}

/** A slice of the engine status: revision, busy, last error, engine version. */
export function useEngineStatus<T>(selector: (state: EngineStatusState) => T): T {
  return useStore(useEngineClient().status, selector);
}
