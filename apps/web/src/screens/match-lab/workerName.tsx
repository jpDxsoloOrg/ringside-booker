import type { ReactNode } from 'react';
import type { PersonId } from '@ringside/engine';
import { WorkerLink } from '@/components/WorkerLink';

/**
 * A worker's name wherever the Match lab shows one (the side chips and the Each worker table): a
 * link to the worker's profile, the same `WorkerLink` WRK1's screens use (MTCH1-08). The name
 * wraps rather than being cut, so a long ring name never pushes the chip's remove button off a
 * phone screen. Person inputs inside the lab's Why? panels link through `AppShell`'s
 * `EntityLinkContext`, so they need nothing here.
 */
export function renderWorkerName(personId: PersonId, name: string, className?: string): ReactNode {
  return <WorkerLink personId={personId} name={name} className={className} />;
}
