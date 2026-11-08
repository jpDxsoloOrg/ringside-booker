import { useLayoutEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { isId, parseId } from '@ringside/engine';
import type { Controller, PromotionId } from '@ringside/engine';
import { routes } from '../routes';
import { useSessionStore } from '../session/sessionStore';
import type { LocalSeat } from '../session/sessionStore';

/** Environment flags that decide whether the dev-only routes are registered. */
export interface DevRouteFlags {
  /** Vite's `import.meta.env.DEV`: true on the dev server. */
  readonly DEV: boolean;
  /** Set to `1` for the e2e build, which is a production build that still needs the helper. */
  readonly VITE_E2E?: string | undefined;
}

/** True in the dev server and the e2e build; false in every build that ships. */
export function devRoutesEnabled(flags: DevRouteFlags): boolean {
  return flags.DEV || flags.VITE_E2E === '1';
}

/** The promotion a faked seat runs when `?promotion=` is not a real promotion ID. */
export const DEV_PROMOTION_ID: PromotionId = parseId('promotion', 'pro_0000000dev');

const DEV_CONTROLLER: Controller = { kind: 'human', playerId: 'dev' };

/** The seat the helper fakes: a human player, running a promotion or not. */
export function devSeat(promotionParam: string | null): LocalSeat {
  let promotionId: PromotionId | null = null;
  if (promotionParam !== null && promotionParam !== '') {
    promotionId = isId('promotion', promotionParam) ? promotionParam : DEV_PROMOTION_ID;
  }
  return {
    viewer: { kind: 'controller', controller: DEV_CONTROLLER },
    controller: DEV_CONTROLLER,
    promotionId,
  };
}

/**
 * Dev and e2e only: `/dev/enter-shell?promotion=pro_dev` pretends a world is loaded, with a seat
 * that runs a promotion (or none, without `promotion`), and opens the shell at the office. It lets
 * the shell be checked before saves and the engine host exist. Never registered in a shipped build.
 */
export function EnterShellRoute() {
  const [searchParams] = useSearchParams();
  const promotionParam = searchParams.get('promotion');

  // Before the redirect renders, so RequireWorld already sees the world as loaded.
  useLayoutEffect(() => {
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: devSeat(promotionParam) });
  }, [promotionParam]);

  const worldLoaded = useSessionStore((state) => state.worldLoaded);
  return worldLoaded ? <Navigate to={routes.game.office()} replace /> : null;
}
