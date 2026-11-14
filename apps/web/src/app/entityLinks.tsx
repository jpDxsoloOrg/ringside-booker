import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { isId } from '@ringside/engine';
import type { PersonId, PromotionId, TitleId } from '@ringside/engine';
import { plainEntityLabel } from '@/components/Trace/rows/rowTypes';
import type { EntityLinkRenderer } from '@/components/Trace/rows/rowTypes';
import { useTracePanelStore } from '@/components/Trace/tracePanelStore';
import { routes } from './routes';

/**
 * How the names of entities inside "Why?" panels are drawn, for everything below the provider.
 * Plain text by default, so the component gallery and the screens outside a game never link to a
 * profile that is not there. `AppShell` provides {@link gameEntityLink}.
 */
export const EntityLinkContext = createContext<EntityLinkRenderer>(plainEntityLabel);

/** The entity-name renderer in force here: the nearest provider's, or plain text. */
export function useEntityLinkRenderer(): EntityLinkRenderer {
  return useContext(EntityLinkContext);
}

/** Navigation state a link to a profile carries, so the profile's back link can return there. */
export interface WorkerLinkState {
  /** The workers list URL the player came from, filters included. */
  readonly workersListUrl: string;
}

/**
 * The state for a link to a worker's profile from `location`: the list's own URL when the link is
 * on the workers list, otherwise whatever list URL the current page was itself opened with (so it
 * survives hopping from one profile to the next).
 */
export function workerLinkState(location: Location): WorkerLinkState | undefined {
  if (location.pathname === routes.game.workers()) {
    return { workersListUrl: `${location.pathname}${location.search}` };
  }
  const carried = workersListUrlFrom(location.state);
  return carried === null ? undefined : { workersListUrl: carried };
}

/** The workers list URL kept in a location's state, or null when there is none worth trusting. */
export function workersListUrlFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('workersListUrl' in state)) return null;
  const { workersListUrl } = state;
  if (typeof workersListUrl !== 'string') return null;
  const listPath = routes.game.workers();
  const isList = workersListUrl === listPath || workersListUrl.startsWith(`${listPath}?`);
  return isList ? workersListUrl : null;
}

export interface PersonProfileLinkProps {
  readonly personId: PersonId;
  readonly className?: string | undefined;
  /** A tooltip, for a link whose text is cut short on screen. */
  readonly title?: string | undefined;
  readonly children: ReactNode;
}

/**
 * A link to one worker's profile. It closes whichever "Why?" panel is open on the way, so a name
 * followed from inside a panel never leaves the panel sitting over the new page.
 */
export function PersonProfileLink({
  personId,
  className,
  title,
  children,
}: PersonProfileLinkProps) {
  const location = useLocation();
  return (
    <Link
      to={routes.game.worker(personId)}
      state={workerLinkState(location)}
      className={className}
      title={title}
      onClick={() => {
        useTracePanelStore.setState({ openPanelId: null });
      }}
    >
      {children}
    </Link>
  );
}

/** Navigation state a link to a promotion carries, so its back link returns to the list. */
export interface PromotionLinkState {
  /** The Promotions list URL the player came from, sort included. */
  readonly promotionsListUrl: string;
}

/** The promotions list URL kept in a location's state, or null when there is none worth trusting. */
export function promotionsListUrlFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('promotionsListUrl' in state)) return null;
  const { promotionsListUrl } = state;
  if (typeof promotionsListUrl !== 'string') return null;
  const listPath = routes.game.promotions();
  const isList = promotionsListUrl === listPath || promotionsListUrl.startsWith(`${listPath}?`);
  return isList ? promotionsListUrl : null;
}

/**
 * The state for a link to a promotion's profile from `location`: the list's own URL (with its
 * sort) when the link is on the Promotions list, else whatever list URL the page carried.
 */
export function promotionLinkState(location: Location): PromotionLinkState | undefined {
  if (location.pathname === routes.game.promotions()) {
    return { promotionsListUrl: `${location.pathname}${location.search}` };
  }
  const carried = promotionsListUrlFrom(location.state);
  return carried === null ? undefined : { promotionsListUrl: carried };
}

export interface PromotionProfileLinkProps {
  readonly promotionId: PromotionId;
  readonly className?: string | undefined;
  /** A tooltip, for a link whose text is cut short on screen. */
  readonly title?: string | undefined;
  readonly children: ReactNode;
}

/** A link to one promotion's profile. Like `PersonProfileLink`, it closes an open "Why?" panel. */
export function PromotionProfileLink({
  promotionId,
  className,
  title,
  children,
}: PromotionProfileLinkProps) {
  const location = useLocation();
  return (
    <Link
      to={routes.game.promotion(promotionId)}
      state={promotionLinkState(location)}
      className={className}
      title={title}
      onClick={() => {
        useTracePanelStore.setState({ openPanelId: null });
      }}
    >
      {children}
    </Link>
  );
}

/** Navigation state a link to a title's page carries, so its back link returns to the list. */
export interface TitleLinkState {
  /** The Titles list URL the player came from, tab and filter included. */
  readonly titlesListUrl: string;
}

/** The Titles list URL kept in a location's state, or null when there is none worth trusting. */
export function titlesListUrlFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('titlesListUrl' in state)) return null;
  const { titlesListUrl } = state;
  if (typeof titlesListUrl !== 'string') return null;
  const listPath = routes.game.titles();
  const isList = titlesListUrl === listPath || titlesListUrl.startsWith(`${listPath}?`);
  return isList ? titlesListUrl : null;
}

/**
 * The state for a link to a title's page from `location`: the list's own URL (with its tab and
 * filter) when the link is on the Titles list, else whatever list URL the page carried.
 */
export function titleLinkState(location: Location): TitleLinkState | undefined {
  if (location.pathname === routes.game.titles()) {
    return { titlesListUrl: `${location.pathname}${location.search}` };
  }
  const carried = titlesListUrlFrom(location.state);
  return carried === null ? undefined : { titlesListUrl: carried };
}

export interface TitlePageLinkProps {
  readonly titleId: TitleId;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/** A link to one title's page (CRTV1-04). Like `PersonProfileLink`, it closes an open "Why?" panel. */
export function TitlePageLink({ titleId, className, children }: TitlePageLinkProps) {
  const location = useLocation();
  return (
    <Link
      to={routes.game.title(titleId)}
      state={titleLinkState(location)}
      className={className}
      onClick={() => {
        useTracePanelStore.setState({ openPanelId: null });
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Entity names in the game: a person's name links to their profile, a promotion's to its profile
 * and a title's to its page; everything else stays plain text until its own screen exists.
 */
export const gameEntityLink: EntityLinkRenderer = (ref, label) => {
  if (ref.kind === 'person' && isId('person', ref.id)) {
    return <PersonProfileLink personId={ref.id}>{label}</PersonProfileLink>;
  }
  if (ref.kind === 'promotion' && isId('promotion', ref.id)) {
    return <PromotionProfileLink promotionId={ref.id}>{label}</PromotionProfileLink>;
  }
  if (ref.kind === 'title' && isId('title', ref.id)) {
    return <TitlePageLink titleId={ref.id}>{label}</TitlePageLink>;
  }
  return label;
};
