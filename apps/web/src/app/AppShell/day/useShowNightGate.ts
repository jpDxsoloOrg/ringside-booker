import { isId } from '@ringside/engine';
import type { GateHit } from '@ringside/engine';
import { useShowNightRoute } from '@/screens/show-night/useShowNightMode';
import type { ShowNightRoute } from '@/screens/show-night/useShowNightMode';
import { leadingGate, SHOW_NIGHT_HINT } from './dayControlState';

/**
 * How the show-day stop's button should go (EVT10-02): for the show night gate that leads, whether
 * its show goes live (Live setting, or part-way through) or opens in Booking (Auto). Asks the
 * engine only while that gate is the one that decides the button.
 */
export function useShowNightGate(
  gates: readonly GateHit[],
  hit: GateHit | undefined = leadingGate(gates),
): ShowNightRoute {
  const showHit = hit?.actionHint === SHOW_NIGHT_HINT ? hit : undefined;
  const subject = showHit?.subject;
  const eventInstanceId =
    subject?.kind === 'eventInstance' && isId('eventInstance', subject.id) ? subject.id : null;
  return useShowNightRoute(eventInstanceId, showHit?.reason ?? null);
}
