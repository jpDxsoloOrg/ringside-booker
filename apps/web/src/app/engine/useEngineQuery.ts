import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { QueryArgs, QueryData, QueryName } from '@ringside/engine';
import { entryData } from './engineClient';
import { useEngineClient } from './EngineProvider';
import { queryKey } from './queryCache';
import type { CacheEntry, EngineQueryError } from './queryCache';

export interface EngineQueryOptions {
  /** False holds the query back, for example until an ID is known. Defaults to true. */
  readonly enabled?: boolean;
  /**
   * Keep showing the last data (marked stale) while new data loads, after a world change or a
   * change of arguments, so screens don't flash empty after every Next Day. Defaults to true.
   */
  readonly keepPreviousData?: boolean;
}

export type EngineQueryStatus = 'loading' | 'success' | 'error';

export interface EngineQueryState<K extends QueryName> {
  /** `loading` until there is something to show, then the state of what is shown. */
  readonly status: EngineQueryStatus;
  readonly data: QueryData<K> | undefined;
  /** The engine's reasons for refusing, or the transport failure. Null on success. */
  readonly error: EngineQueryError | null;
  /** The world revision the shown result was computed at, or null before the first result. */
  readonly revision: number | null;
  /** True while the shown result is older than the world or belongs to the previous arguments. */
  readonly isStale: boolean;
}

/**
 * Keeps `args` referentially stable while the cache key stays the same, so effects depending on
 * them run only when the arguments really change.
 */
function useStableArgs<T>(key: string, args: T): T {
  const [held, setHeld] = useState({ key, args });
  if (held.key !== key) {
    setHeld({ key, args });
    return args;
  }
  return held.args;
}

/**
 * Runs an engine query for the local seat and keeps it current. Results are cached by name and
 * arguments; a mounted query refetches whenever the world revision moves past the revision its
 * result was computed at (after a command or each simulated day). While it refetches, the previous
 * result stays on screen with `isStale: true`.
 *
 * Nothing is set after the component unmounts: results land in the shared cache, and the
 * component reads them only while it is subscribed.
 */
export function useEngineQuery<K extends QueryName>(
  name: K,
  args: QueryArgs<K>,
  { enabled = true, keepPreviousData = true }: EngineQueryOptions = {},
): EngineQueryState<K> {
  const client = useEngineClient();
  const { cache } = client;
  const key = queryKey(name, args);
  const stableArgs = useStableArgs(key, args);
  const worldRevision = useStore(client.status, (state) => state.revision);

  const subscribe = useCallback(
    (onChange: () => void) => cache.subscribe(key, onChange),
    [cache, key],
  );
  const readEntry = useCallback(() => cache.peek(key), [cache, key]);
  const entry = useSyncExternalStore(subscribe, readEntry, readEntry);

  // The last entry shown, kept across argument changes for keepPreviousData.
  const [lastShown, setLastShown] = useState<CacheEntry | undefined>(entry);
  if (entry !== undefined && entry !== lastShown) {
    setLastShown(entry);
  }

  const entryRevision = entry?.revision;
  useEffect(() => {
    if (!enabled) return;
    if (entryRevision !== undefined && entryRevision >= worldRevision) return;
    void client.fetchQuery(name, stableArgs);
  }, [client, enabled, entryRevision, name, stableArgs, worldRevision]);

  const shown = entry ?? (keepPreviousData ? lastShown : undefined);
  if (shown === undefined) {
    return { status: 'loading', data: undefined, error: null, revision: null, isStale: false };
  }
  const isStale = shown !== entry || shown.revision < worldRevision;
  if (shown.outcome.ok) {
    return {
      status: 'success',
      data: entryData<K>(shown),
      error: null,
      revision: shown.revision,
      isStale,
    };
  }
  return {
    status: 'error',
    data: undefined,
    error: shown.outcome.error,
    revision: shown.revision,
    isStale,
  };
}
