import { Navigate, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { routes } from './routes';
import { useWorldLoaded } from './session/sessionStore';

/** Navigation state RequireWorld sends to the title screen, so it can say why. */
export interface NoWorldRedirectState {
  readonly reason: 'no-world';
}

export const NO_WORLD_REDIRECT_STATE: NoWorldRedirectState = { reason: 'no-world' };

/** True when the title screen was reached because an in-game route needed a world. */
export function isNoWorldRedirect(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'reason' in state &&
    state.reason === NO_WORLD_REDIRECT_STATE.reason
  );
}

export interface RequireWorldProps {
  /** What to render once a world is loaded. The nested routes' outlet when left out. */
  readonly children?: ReactNode;
}

/**
 * Guards the in-game routes: without a loaded world (a reload, or a shared `/game/...` link)
 * there is nothing to show, so it sends the player to the title screen to load or start a game.
 */
export function RequireWorld({ children }: RequireWorldProps) {
  const worldLoaded = useWorldLoaded();
  if (!worldLoaded) {
    return <Navigate to={routes.title()} replace state={NO_WORLD_REDIRECT_STATE} />;
  }
  return children === undefined ? <Outlet /> : <>{children}</>;
}
