import type { ContractEndReason, GameDate } from '@ringside/engine';
import { Badge } from '../Badge';
import { classNames } from '../classNames';
import { formatGameDate, formatNumber, formatPercent } from '../format';
import type { RoleTone } from '../tone';
import styles from './ContractStatusChip.module.css';

/**
 * One state a contract can be in, as the Contracts screen and the profile's Contract tab show it.
 * A row can carry several at once (an expiring contract with a notice not yet seen shows both).
 */
export type ContractStatus =
  /** Running, nothing to watch. */
  | { readonly kind: 'active' }
  /** Signed, starting on a later day. */
  | { readonly kind: 'starts'; readonly on: GameDate }
  /** Ending soon. `warn` when inside the expiring-soon window, so it draws in the warning tone. */
  | { readonly kind: 'expiring'; readonly daysLeft: number; readonly warn: boolean }
  /** An expiring-soon notice the player has not seen yet. */
  | { readonly kind: 'unseen' }
  /** An open release request. */
  | { readonly kind: 'wantsToLeave' }
  /** The unhappy clock: day `days` of `of`, or paused by a hot storyline. */
  | {
      readonly kind: 'unhappy';
      readonly days: number;
      readonly of: number;
      readonly paused: boolean;
    }
  /** After a refused request: the daily chance they walk out, 0 to 1. */
  | { readonly kind: 'walkoutRisk'; readonly chance: number }
  /** Over, and how it ended. */
  | { readonly kind: 'ended'; readonly reason: ContractEndReason };

export type ContractStatusKind = ContractStatus['kind'];

/** How a contract ended, in words. */
export const CONTRACT_END_LABELS: Readonly<Record<ContractEndReason, string>> = {
  expired: 'Expired',
  released: 'Released',
  quit: 'Quit',
  walkedOut: 'Walked out',
  exclusiveDeal: 'Left for an exclusive deal',
  withdrawn: 'Called off',
};

/** "59 days left", "1 day left", "Ends today". */
export function daysLeftText(daysLeft: number): string {
  if (daysLeft <= 0) return 'Ends today';
  return `${formatNumber(daysLeft)} ${daysLeft === 1 ? 'day' : 'days'} left`;
}

/** A daily chance as a percent: whole when it is ("3%"), else to a tenth ("2.5%"). */
export function chancePercent(chance: number): string {
  return formatPercent(chance, Math.round(chance * 1000) % 10 === 0 ? 0 : 1);
}

/** The words on the chip. Colour is never the only signal. */
export function contractStatusText(status: ContractStatus): string {
  switch (status.kind) {
    case 'active':
      return 'Active';
    case 'starts':
      return `Starts ${formatGameDate(status.on)}`;
    case 'expiring':
      return daysLeftText(status.daysLeft);
    case 'unseen':
      return 'New';
    case 'wantsToLeave':
      return 'Wants to leave';
    case 'unhappy':
      return status.paused
        ? 'Unhappy (paused)'
        : `Unhappy ${formatNumber(status.days)}/${formatNumber(status.of)}`;
    case 'walkoutRisk':
      return `Walk-out risk ${chancePercent(status.chance)}`;
    case 'ended':
      return CONTRACT_END_LABELS[status.reason];
  }
}

/** What a screen reader hears when the short words need more. */
function spokenText(status: ContractStatus): string | null {
  switch (status.kind) {
    case 'unseen':
      return 'New: contract ending soon, not yet seen';
    case 'unhappy':
      return status.paused
        ? 'Unhappy, clock paused by a hot storyline'
        : `Unhappy: day ${formatNumber(status.days)} of ${formatNumber(status.of)} before asking to leave`;
    case 'walkoutRisk':
      return `Walk-out risk: ${chancePercent(status.chance)} a day`;
    case 'active':
    case 'starts':
    case 'expiring':
    case 'wantsToLeave':
    case 'ended':
      return null;
  }
}

/** The colour role for each state. */
export function contractStatusTone(status: ContractStatus): RoleTone {
  switch (status.kind) {
    case 'active':
      return 'positive';
    case 'starts':
      return 'data';
    case 'expiring':
      return status.warn ? 'prestige' : 'neutral';
    case 'unseen':
      return 'action';
    case 'wantsToLeave':
    case 'walkoutRisk':
      return 'negative';
    case 'unhappy':
      return 'prestige';
    case 'ended':
      return 'neutral';
  }
}

export interface ContractStatusChipProps {
  readonly status: ContractStatus;
  readonly className?: string | undefined;
}

/** A contract's state as a small chip: the words and the colour role together. */
export function ContractStatusChip({ status, className }: ContractStatusChipProps) {
  const spoken = spokenText(status);
  const solid = status.kind === 'unseen' || status.kind === 'wantsToLeave';
  return (
    <span
      className={classNames(styles['chip'], className)}
      data-status={status.kind}
      {...(spoken === null ? {} : { 'aria-label': spoken, role: 'img' })}
    >
      <Badge tone={contractStatusTone(status)} variant={solid ? 'solid' : 'soft'}>
        {contractStatusText(status)}
      </Badge>
    </span>
  );
}
