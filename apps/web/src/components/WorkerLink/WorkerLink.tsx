import type { PersonId } from '@ringside/engine';
import { PersonProfileLink } from '@/app/entityLinks';
import { classNames } from '../classNames';
import styles from './WorkerLink.module.css';

export interface WorkerLinkProps {
  readonly personId: PersonId;
  /** The name to show: the ring name the screen already has. */
  readonly name: string;
  /**
   * Keeps the name on one line and cuts it with an ellipsis where it runs out of room, for table
   * cells and cards. The link still carries the whole name: screen readers read it in full, and it
   * shows as a tooltip when pointed at. Off by default, where a long name wraps.
   */
  readonly truncate?: boolean;
  readonly className?: string | undefined;
}

/**
 * A person's name as a link to their profile: the same link the "Why?" panels draw for people, so
 * a name behaves the same wherever it appears in the game. From the workers list it remembers the
 * list's filters, and the profile's back link returns to them.
 */
export function WorkerLink({ personId, name, truncate = false, className }: WorkerLinkProps) {
  return (
    <PersonProfileLink
      personId={personId}
      className={classNames(styles['workerLink'], truncate && styles['truncate'], className)}
      {...(truncate ? { title: name } : {})}
    >
      {name}
    </PersonProfileLink>
  );
}
