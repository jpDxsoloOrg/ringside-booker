/**
 * The calendar show sheet's way into show night (EVT10-02): "Go live" on the day of one of your
 * open shows when it goes live (the Show night setting is Live), or "Back to the show" while it is
 * part-way through. Registered by the router, so it is in place before any calendar draws; the
 * screen itself stays in its own chunk.
 */
import { useNavigate } from 'react-router-dom';
import type { EventInstanceId } from '@ringside/engine';
import { Button } from '@/components/Button';
import { BACK_TO_SHOW_LABEL, GO_LIVE_LABEL } from '@/app/AppShell/day/dayControlState';
import { routes } from '@/app/routes';
import { registerShowSheetAction } from '@/screens/calendar/registry';
import type { ShowSheetActionDefinition, ShowSheetContext } from '@/screens/calendar/registry';
import { useShowNightRoute } from './useShowNightMode';

/** True for one of your shows that is on today and still to finish. */
export function isOwnShowTonight({ show, isOwn, today }: ShowSheetContext): boolean {
  return (
    isOwn &&
    show.eventInstanceId !== null &&
    (show.status === 'scheduled' || show.status === 'booked') &&
    show.date === today
  );
}

function GoLiveButton({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const navigate = useNavigate();
  const route = useShowNightRoute(eventInstanceId);
  if (!route.goesLive) return null;
  return (
    <Button
      variant="primary"
      iconStart="live"
      onClick={() => {
        navigate(routes.game.showNight(eventInstanceId));
      }}
    >
      {route.underWay ? BACK_TO_SHOW_LABEL : GO_LIVE_LABEL}
    </Button>
  );
}

export const GO_LIVE_ACTION: ShowSheetActionDefinition = {
  id: 'showNight.goLive',
  order: 5,
  render: (context) =>
    isOwnShowTonight(context) && context.show.eventInstanceId !== null ? (
      <GoLiveButton eventInstanceId={context.show.eventInstanceId} />
    ) : null,
};

registerShowSheetAction(GO_LIVE_ACTION);
