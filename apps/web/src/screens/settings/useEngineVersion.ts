import { useEffect, useState } from 'react';
import { useOptionalEngineClient } from '@/app/engine/EngineProvider';

/** The engine version as the running worker reports it. */
export type EngineVersionState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'known'; readonly engineVersion: string }
  | { readonly kind: 'unavailable' };

const UNAVAILABLE: EngineVersionState = { kind: 'unavailable' };
const CHECKING: EngineVersionState = { kind: 'checking' };

/**
 * Pings the engine once and keeps the version it answers with. Unavailable when there is no
 * engine (a screen rendered on its own) or the ping fails.
 */
export function useEngineVersion(): EngineVersionState {
  const client = useOptionalEngineClient();
  const [answer, setAnswer] = useState<EngineVersionState | null>(null);

  useEffect(() => {
    if (client === null) return undefined;
    let cancelled = false;
    const askEngine = async (): Promise<void> => {
      let next: EngineVersionState;
      try {
        const { engineVersion } = await client.ping();
        next = { kind: 'known', engineVersion };
      } catch {
        next = UNAVAILABLE;
      }
      if (!cancelled) setAnswer(next);
    };
    void askEngine();
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (client === null) return UNAVAILABLE;
  return answer ?? CHECKING;
}
