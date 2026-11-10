import type { PersonRole } from '@ringside/engine';

/** The roles as a chip or a filter option names them. */
export const WORKER_ROLE_LABELS: Readonly<Record<PersonRole, string>> = {
  wrestler: 'Wrestler',
  occasionalWrestler: 'Occasional wrestler',
  manager: 'Manager',
  presenter: 'Presenter',
  announcer: 'Announcer',
  referee: 'Referee',
  producer: 'Producer',
};

/** What the list writes where someone has no employer. */
export const FREE_AGENT_LABEL = 'Free agent';
