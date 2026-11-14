import { FINISH_TONIGHT_FIRST, parseId } from '@ringside/engine';
import type { EventInstanceId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';

/** How the show screen's ways in should treat one of your shows tonight (EVT10-02). */
export interface ShowNightRoute {
  /**
   * True when the show goes live on the show night screen: the Show night setting is Live, or the
   * show is already part-way through. False under Auto, where Run the show runs it all at once.
   */
  readonly goesLive: boolean;
  /** True while the show is part-way through: it can only be finished, from the show night screen. */
  readonly underWay: boolean;
}

/** Asked for nothing while there is no show: the query is held back then. */
const NO_SHOW = parseId('eventInstance', 'evi_0000000000');

/**
 * Whether tonight's show goes live. Live is the setting's default, so it is assumed until the
 * engine answers;
 * then it is read from `shows.liveState` (its `mode` and `stage`). `reason`
 * is the show-day stop's reason, when there is one: "Finish tonight's show first" already says
 * the show is under way before the engine answers.
 */
export function useShowNightRoute(
  eventInstanceId: EventInstanceId | null,
  reason: string | null = null,
): ShowNightRoute {
  const query = useEngineQuery(
    'shows.liveState',
    { eventInstanceId: eventInstanceId ?? NO_SHOW },
    { enabled: eventInstanceId !== null },
  );
  const data = query.data;
  const underWay =
    data !== undefined
      ? data.stage === 'live'
      : (reason?.startsWith(FINISH_TONIGHT_FIRST) ?? false);
  // An unknown show (or no answer at all) keeps the plain way in: the show's card in Booking.
  if (query.status === 'error') return { goesLive: underWay, underWay };
  if (data === undefined) return { goesLive: true, underWay };
  return { goesLive: data.mode === 'live' || underWay, underWay };
}
