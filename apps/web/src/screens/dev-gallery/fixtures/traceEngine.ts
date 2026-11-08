/**
 * A stand-in engine for the gallery's "Why?" panel demo. The gallery has no game loaded, so this
 * transport answers `trace.get` from fixture entries, after a short pause so the loading state
 * shows, and refuses everything else. Screens get the same answers from the real engine.
 */
import { ENGINE_VERSION, refKey } from '@ringside/engine';
import type {
  LoadFailure,
  QueryArgs,
  QueryData,
  QueryName,
  Reason,
  StoredTraceEntry,
} from '@ringside/engine';
import type { EngineTransport } from '@/app/engine/transport';
import type { HostQueryResponse } from '@/worker/engineHost';
import type { LoadSaveFailure, SaveSlotResult } from '@/worker/saveGames';

/** How long the stand-in takes to answer, so the panel's loading state is visible. */
const ANSWER_DELAY_MS = 600;

/** The world revision every answer reports; nothing here ever changes. */
const FIXTURE_REVISION = 1;

const NOT_IN_GALLERY: Reason = {
  code: 'notInGallery',
  message: 'The gallery only answers trace lookups.',
};

/** The gallery keeps no saves: every save, load and import is refused with this. */
const NO_SAVES_IN_GALLERY = 'The gallery has no saves.';

const SAVE_REFUSED: SaveSlotResult = {
  ok: false,
  message: NO_SAVES_IN_GALLERY,
  storageError: null,
};

const LOAD_REFUSED: LoadSaveFailure = {
  ok: false,
  stage: 'storage',
  issues: [{ path: '', message: NO_SAVES_IN_GALLERY }],
  truncated: 0,
  storageError: null,
};

const INSPECT_REFUSED: LoadFailure = {
  ok: false,
  stage: 'decode',
  issues: [{ path: '', message: NO_SAVES_IN_GALLERY }],
  truncated: 0,
};

type FixtureQueries = { readonly [K in QueryName]?: (args: QueryArgs<K>) => QueryData<K> };

async function pause(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/** A transport whose `trace.get` returns the matching entry, or null for an unknown ref. */
export function createTraceFixtureTransport(
  entries: readonly StoredTraceEntry[],
  answerDelayMs = ANSWER_DELAY_MS,
): EngineTransport {
  const byKey = new Map(entries.map((entry) => [refKey(entry.ref), entry]));
  const queries: FixtureQueries = {
    'trace.get': (args) => byKey.get(refKey(args.ref)) ?? null,
  };

  return {
    host: {
      ping: () => Promise.resolve({ engineVersion: ENGINE_VERSION }),
      async query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<HostQueryResponse<K>> {
        await pause(answerDelayMs);
        const run = queries[name];
        if (run === undefined) {
          return { revision: FIXTURE_REVISION, result: { ok: false, reasons: [NOT_IN_GALLERY] } };
        }
        return { revision: FIXTURE_REVISION, result: { ok: true, data: run(args) } };
      },
      command: () =>
        Promise.resolve({
          revision: FIXTURE_REVISION,
          result: { ok: false, reasons: [NOT_IN_GALLERY] },
        }),
      advanceDays: () =>
        Promise.resolve({ ok: false, reasons: [NOT_IN_GALLERY], revision: FIXTURE_REVISION }),
      cancelAdvance: () => undefined,
      isWorldLoaded: () => true,
      getSeat: () => null,
      loadFromSlot: () => Promise.resolve(LOAD_REFUSED),
      saveToSlot: () => Promise.resolve(SAVE_REFUSED),
      createSlot: () => Promise.resolve(SAVE_REFUSED),
      autosave: () => Promise.resolve(SAVE_REFUSED),
      inspectSave: () => Promise.resolve(INSPECT_REFUSED),
      listWorldPacks: () => Promise.resolve({ packs: [], issues: [] }),
      previewWorld: () => Promise.resolve({ ok: false, issues: [] }),
      startNewGame: () =>
        Promise.resolve({ ok: false, reasons: [NOT_IN_GALLERY], revision: FIXTURE_REVISION }),
      unloadWorld: () => ({ revision: FIXTURE_REVISION }),
    },
    onFatal: () => () => undefined,
    terminate: () => undefined,
    crashForTesting: () => undefined,
  };
}
