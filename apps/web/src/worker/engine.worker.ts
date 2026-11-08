/**
 * The engine Web Worker. The simulation runs here and nowhere else in the built app: the main
 * thread reaches it only through the Comlink proxy that `createWorkerTransport` wraps around it.
 *
 * An uncaught error or unhandled rejection posts an `engine.fatal` message first, so the app can
 * show the "simulation stopped" screen instead of waiting on a worker that will never answer.
 */

import * as Comlink from 'comlink';
import { createEngine } from '@ringside/engine';
import { createEngineHost } from './engineHost';
import {
  CRASH_FOR_TESTING_MESSAGE,
  describeThrown,
  ENGINE_FATAL_MESSAGE_TYPE,
  isEngineCrashRequest,
} from './workerMessages';
import type { EngineFatalMessage } from './workerMessages';

// This module runs as a dedicated worker, not in a window. The app's TypeScript project includes
// the DOM library for every other file, so the worker scope is declared here for this module only.
declare const self: DedicatedWorkerGlobalScope;

function postFatal(thrown: unknown, fallbackMessage: string): void {
  const described = describeThrown(thrown);
  const fatal: EngineFatalMessage = {
    type: ENGINE_FATAL_MESSAGE_TYPE,
    message: described.message === '' ? fallbackMessage : described.message,
    stack: described.stack,
  };
  self.postMessage(fatal);
}

self.addEventListener('error', (event) => {
  postFatal(event.error ?? event.message, event.message);
});

self.addEventListener('unhandledrejection', (event) => {
  postFatal(event.reason, 'An engine task failed without saying why');
});

// Dev and e2e builds only: the gallery's "Crash engine" button asks the worker to throw outside
// any Comlink call, which is what a real crash looks like.
// The same flags as the dev-only routes, read directly so the worker bundle stays free of React.
if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') {
  self.addEventListener('message', (event) => {
    if (!isEngineCrashRequest(event.data)) return;
    self.setTimeout(() => {
      throw new Error(CRASH_FOR_TESTING_MESSAGE);
    }, 0);
  });
}

Comlink.expose(createEngineHost(createEngine));
