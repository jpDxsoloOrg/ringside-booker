import type { ReactNode } from 'react';
import type { PersonId } from '@ringside/engine';

/**
 * A worker's name wherever the Match lab shows one. Plain text for now; MTCH1-08 turns it into a
 * link to the worker's profile, here and only here.
 */
export function renderWorkerName(_personId: PersonId, name: string): ReactNode {
  return name;
}
