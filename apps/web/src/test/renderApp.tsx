/**
 * Renders the whole app at a path for screen tests: the real route tree in a memory router, the
 * engine host in process (the UI-08 test engine) and the slot screens' storage calls from a fake.
 * Loads and saves go through the host to the real storage module, which runs on fake-indexeddb.
 */

import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useLayoutEffect } from 'react';
import type { EngineClient } from '@/app/engine/engineClient';
import { EngineProvider, useEngineClient } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { SaveStorageProvider } from '@/screens/saves/saveStorage';
import { CURRENT_FORMAT_VERSION, ENGINE_VERSION } from '@ringside/engine';
import * as storage from '@/storage';
import type { SlotRecord } from '@/storage';
import type { FakeStorage } from './fakeStorage';
import { fakeEngineFactory } from './fakeEngine';
import { goldenSaveDocument } from './goldenSave';

export type AppRouter = ReturnType<typeof createMemoryRouter>;

export interface RenderedApp {
  readonly router: AppRouter;
  readonly transport: InProcessTransport;
  /** The engine client the app uses, for tests that drive its status directly. */
  readonly client: EngineClient;
}

/** Hands the provider's engine client to the test. */
function ClientProbe({ onClient }: { readonly onClient: (client: EngineClient) => void }) {
  const client = useEngineClient();
  useLayoutEffect(() => {
    onClient(client);
  }, [client, onClient]);
  return null;
}

/** The app at `path`, with `fakeStorage` behind the slot screens. */
export function renderApp(path: string, fakeStorage: FakeStorage): RenderedApp {
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const probe: { client: EngineClient | null } = { client: null };
  render(
    <EngineProvider createTransport={() => transport}>
      <ClientProbe
        onClient={(client) => {
          probe.client = client;
        }}
      />
      <SaveStorageProvider storage={fakeStorage}>
        <RouterProvider router={router} future={routerProviderFutureFlags} />
      </SaveStorageProvider>
    </EngineProvider>,
  );
  if (probe.client === null) throw new Error('The engine client never rendered.');
  return { router, transport, client: probe.client };
}

export interface StoredSlotOptions {
  readonly label?: string;
  /** Real-world time of the save; slot lists sort on it. */
  readonly savedAt?: string;
}

/**
 * Stores `bytes` as a real slot in (fake) IndexedDB under the golden save's header, so the engine
 * host can load it, and returns its record for the fake slot list.
 */
export async function storeRealSlot(
  bytes: Uint8Array,
  options: StoredSlotOptions = {},
): Promise<SlotRecord> {
  const { header } = goldenSaveDocument();
  const label = options.label ?? 'Golden league';
  const created = await storage.createSlot(
    label,
    bytes,
    { ...header, label },
    {
      formatVersion: CURRENT_FORMAT_VERSION,
      engineVersion: ENGINE_VERSION,
      savedAt: options.savedAt ?? '2026-11-05T10:00:00.000Z',
    },
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}
