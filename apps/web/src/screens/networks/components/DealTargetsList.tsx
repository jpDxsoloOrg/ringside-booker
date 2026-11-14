import { shortViewers } from '@ringside/engine';
import type { DealTargets, NetworkKind, Traced } from '@ringside/engine';
import { WhyButton } from '@/components/Trace';
import styles from './DealTargetsList.module.css';

/** "75%". */
function percent(share: number): string {
  return `${String(Math.round(share * 100))}%`;
}

/** The step `shortViewers` shows a count in: 0.1M, 1K, 0.1K or 1. */
function shortStep(count: number): number {
  if (count >= 1_000_000) return 100_000;
  if (count >= 10_000) return 1_000;
  if (count >= 1_000) return 100;
  return 1;
}

/**
 * "2.2M", or "113K buys" on pay-per-view (TV and streaming count viewers). A target is rounded
 * up to the shown step, so reaching the number on screen is always enough.
 */
function amount(count: number, kind: NetworkKind, up = true): string {
  const step = shortStep(count);
  const shown = shortViewers(up ? Math.ceil(count / step) * step : count);
  return kind === 'ppv' ? `${shown} buys` : shown;
}

/** One target as the deal screens say it. */
export interface DealTargetLine {
  readonly id: 'safe' | 'cancel' | 'bonus';
  /** The sentence: "Stay above 2.1M (75% of 2.8M expected) to stay safe". */
  readonly text: string;
  /** The short form for a table cell: "Safe above 2.1M". */
  readonly short: string;
  /** The Why?'s label. */
  readonly label: string;
  readonly viewers: Traced<number>;
}

/**
 * The three lines a deal is judged by, in viewers (ECO8-10): stay safe, may cancel, ratings
 * bonus. The same words on the deal sheet, the Your deals row, Propose and renewal.
 */
export function dealTargetLines(targets: DealTargets, kind: NetworkKind): DealTargetLine[] {
  const { safe, cancel, bonus } = targets;
  return [
    {
      id: 'safe',
      text: `Stay above ${amount(safe.viewers.value, kind)} (${percent(safe.share)} of ${amount(targets.expected, kind, false)} expected) to stay safe`,
      short: `Safe above ${amount(safe.viewers.value, kind)}`,
      label: 'The line to stay safe',
      viewers: safe.viewers,
    },
    {
      id: 'cancel',
      text: `Below ${amount(cancel.viewers.value, kind)} (${percent(cancel.share)}) they may cancel`,
      short: `May cancel below ${amount(cancel.viewers.value, kind)}`,
      label: 'The line below which they may cancel',
      viewers: cancel.viewers,
    },
    {
      id: 'bonus',
      text: `Beat ${amount(bonus.viewers.value, kind)} (${percent(bonus.share)}) for a ratings bonus`,
      short: `Bonus above ${amount(bonus.viewers.value, kind)}`,
      label: 'The ratings bonus line',
      viewers: bonus.viewers,
    },
  ];
}

/** What the bonus line means, in words: said once under the full list. */
export function ratingsBonusText(kind: NetworkKind): string {
  const on = kind === 'ppv' ? 'the per-buy money' : 'the fee';
  return `Viewers are judged over recent airings. While they stay above the bonus line, every airing pays a ratings bonus on top of ${on}: more the further above it, up to a cap.`;
}

export interface DealTargetsListProps {
  readonly targets: DealTargets;
  readonly kind: NetworkKind;
  readonly networkName: string;
  /** `full` (sheets): the sentences and what the bonus means; `compact` (table rows): short lines. */
  readonly variant?: 'full' | 'compact';
}

/** A deal's targets, each with its Why?. */
export function DealTargetsList({
  targets,
  kind,
  networkName,
  variant = 'full',
}: DealTargetsListProps) {
  const lines = dealTargetLines(targets, kind);
  const compact = variant === 'compact';
  return (
    <div className={compact ? styles['compact'] : styles['full']}>
      <ul className={styles['list']} aria-label={`What ${networkName} expects of the deal`}>
        {lines.map((line) => (
          <li key={line.id} className={styles['line']} data-target={line.id}>
            <span>{compact ? line.short : line.text}</span>
            <WhyButton
              label={line.label}
              value={line.viewers.value}
              unit="count"
              source={{ trace: line.viewers.trace }}
            />
          </li>
        ))}
      </ul>
      {!compact && <p className={styles['note']}>{ratingsBonusText(kind)}</p>}
    </div>
  );
}
