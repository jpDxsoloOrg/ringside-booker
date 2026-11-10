import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { isId } from '@ringside/engine';
import type { PersonId } from '@ringside/engine';
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

/**
 * Entity names in the game: a person's name links to their profile; everything else stays plain
 * text until its own screen exists.
 */
export const gameEntityLink: EntityLinkRenderer = (ref, label) =>
  ref.kind === 'person' && isId('person', ref.id) ? (
    <PersonProfileLink personId={ref.id}>{label}</PersonProfileLink>
  ) : (
    label
  );
