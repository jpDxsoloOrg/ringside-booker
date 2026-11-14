import { useEffect, useRef } from 'react';
import { isId } from '@ringside/engine';
import type { NegotiationId } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';

/**
 * Marks workers' answers as seen once they are on screen (ECO5-10), which clears the day bar's
 * "Offer answered" stop: `contracts.markOffersSeen` for every id in `negotiationIds` (the talks
 * whose `answerUnseen` is true). The Negotiation Sheet calls it for the talks it shows, the worker
 * profile for that worker's answered talks. Each id is sent once (a ref, so StrictMode's double
 * effect and a refetch that arrives before the command lands do not send it twice); the engine
 * passes over ids it no longer has, so this can never leave a stop that cannot be cleared.
 */
export function useMarkOffersSeen(negotiationIds: readonly NegotiationId[]): void {
  const { run } = useEngineCommand('contracts.markOffersSeen');
  const sent = useRef(new Set<NegotiationId>());
  const key = [...negotiationIds].sort().join(',');
  useEffect(() => {
    const unsent = key
      .split(',')
      .filter((id): id is NegotiationId => isId('negotiation', id) && !sent.current.has(id));
    if (unsent.length === 0) return;
    for (const id of unsent) sent.current.add(id);
    void run({ negotiationIds: unsent });
  }, [key, run]);
}
