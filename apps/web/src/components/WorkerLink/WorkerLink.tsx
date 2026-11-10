import type { PersonId } from '@ringside/engine';
import { PersonProfileLink } from '@/app/entityLinks';
import { classNames } from '../classNames';
import styles from './WorkerLink.module.css';

export interface WorkerLinkProps {
  readonly personId: PersonId;
  /** The name to show: the ring name the screen already has. */
  readonly name: string;
  readonly className?: string | undefined;
}

/**
 * A person's name as a link to their profile: the same link the "Why?" panels draw for people, so
 * a name behaves the same wherever it appears in the game. From the workers list it remembers the
 * list's filters, and the profile's back link returns to them.
 */
export function WorkerLink({ personId, name, className }: WorkerLinkProps) {
  return (
    <PersonProfileLink personId={personId} className={classNames(styles['workerLink'], className)}>
      {name}
    </PersonProfileLink>
  );
}
