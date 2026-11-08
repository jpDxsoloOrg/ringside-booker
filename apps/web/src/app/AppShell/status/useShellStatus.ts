import type { GateHit, SimStatus } from '@ringside/engine';
import { useEngineQuery } from '../../engine/useEngineQuery';

/** What the top bar reads: the game's status and the gates waiting today. */
export interface ShellStatus {
  /**
   * The date, season and the local seat's promotion at a glance. Undefined until the first answer
   * arrives, and while no world is loaded (the engine refuses the query then).
   */
  readonly status: SimStatus | undefined;
  /**
   * Why Next Day would stop today, in the engine's registration order. Empty when nothing is
   * waiting, and until the first answer arrives.
   */
  readonly gates: readonly GateHit[];
  /** True until both queries have answered once. */
  readonly loading: boolean;
}

const NO_GATES: readonly GateHit[] = [];

/**
 * The top bar's two engine queries: `sim.status` and `sim.pendingGates`. Both are engine built-ins
 * that run for the viewer the host injects, so nothing here names a viewer or a promotion. The
 * last answers stay on screen while new ones load after each day, so the bar never flashes empty.
 */
export function useShellStatus(): ShellStatus {
  const statusQuery = useEngineQuery('sim.status', {});
  const gatesQuery = useEngineQuery('sim.pendingGates', {});
  return {
    status: statusQuery.data,
    gates: gatesQuery.data?.hits ?? NO_GATES,
    loading: statusQuery.status === 'loading' || gatesQuery.status === 'loading',
  };
}
