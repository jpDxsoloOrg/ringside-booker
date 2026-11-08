import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { AdvanceOutcome, AdvanceProgress, AdvanceRequest } from '@/worker/engineHost';
import { useEngineClient } from './EngineProvider';

export interface AdvanceDaysState {
  /**
   * Moves the world forward up to `request.maxDays` days. Resolves with why it stopped (the days
   * ran out, a gate, or a cancel) or with the reasons it could not start, such as another advance
   * already running. Rejects only when the engine could not be reached.
   */
  readonly start: (request: AdvanceRequest) => Promise<AdvanceOutcome>;
  /** Stops the running advance after the day it is on. */
  readonly cancel: () => void;
  /** The latest progress of this component's advance, or null before the first report. */
  readonly progress: AdvanceProgress | null;
  /** True while any advance runs, whoever started it, so a screen can show an overlay. */
  readonly running: boolean;
}

/**
 * Multi-day advance with progress and cancel. The status store reads `busy: 'advancing'` while it
 * runs. Queries made meanwhile are answered between days, and every simulated day moves the world
 * revision on, so mounted queries keep up.
 */
export function useAdvanceDays(): AdvanceDaysState {
  const client = useEngineClient();
  const running = useStore(client.status, (state) => state.advancing);
  const [progress, setProgress] = useState<AdvanceProgress | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(
    async (request: AdvanceRequest): Promise<AdvanceOutcome> => {
      setProgress(null);
      return client.advanceDays(request, (next) => {
        if (mounted.current) setProgress(next);
      });
    },
    [client],
  );

  const cancel = useCallback(() => {
    client.cancelAdvance();
  }, [client]);

  return { start, cancel, progress, running };
}
