import type { ContractChange, ContractChanges } from '@ringside/engine';
import { routes } from '../../routes';

/** How many contract lines the Next Day summary lists before "and N more". */
export const MAX_CONTRACT_LINES = 3;

function quitLine(change: ContractChange): string {
  if (change.how === 'walkedOut') return `${change.ringName} walked out`;
  if (change.how === 'granted') return `${change.ringName} left: you let them go`;
  if (change.how === 'exclusiveDeal') return `${change.ringName} left for an exclusive deal`;
  return `${change.ringName} quit`;
}

/**
 * The contract changes an advance brought, one plain line each, most pressing first: requests to
 * leave, quits and walk-outs, expiries, releases, new contracts, then renewals.
 */
export function contractChangeLines(changes: ContractChanges): string[] {
  return [
    ...changes.requests.map((change) => `${change.ringName} wants to leave`),
    ...changes.quit.map(quitLine),
    ...changes.expired.map((change) => `${change.ringName}'s contract expired`),
    ...changes.released.map((change) =>
      change.how === 'withdrawn'
        ? `The deal with ${change.ringName} was called off`
        : `${change.ringName} was released`,
    ),
    ...changes.started.map((change) => `${change.ringName}'s contract started`),
    ...changes.renewed.map(
      (change) => change.line?.replace(/\.$/u, '') ?? `${change.ringName}'s contract was renewed`,
    ),
  ];
}

/**
 * True when the changes deserve the banner on a one-day Next Day: anything but a quiet renewal or
 * a contract starting on its date.
 */
export function contractChangesNeedBanner(changes: ContractChanges | undefined): boolean {
  if (changes === undefined) return false;
  return (
    changes.requests.length +
      changes.quit.length +
      changes.expired.length +
      changes.released.length >
    0
  );
}

/** Where "and N more" goes: Ended when anything ended, else Active. */
export function contractChangesLink(changes: ContractChanges): string {
  const ended = changes.quit.length + changes.expired.length + changes.released.length > 0;
  return `${routes.game.contracts()}?tab=${ended ? 'ended' : 'active'}`;
}
