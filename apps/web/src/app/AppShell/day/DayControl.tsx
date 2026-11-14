import { useCallback, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GateHit } from '@ringside/engine';
import { IconButton } from '@/components/Button';
import { VisuallyHidden } from '@/components/layout';
import { LiveBugButton } from '@/components/LiveBugButton';
import { Sheet } from '@/components/Sheet';
import { deriveDayControl } from './dayControlState';
import type { DayPrimaryAction } from './dayControlState';
import { useDayAdvance } from './DayAdvanceProvider';
import styles from './DayControl.module.css';
import { DAY_SHORTCUT, useDayShortcut } from './useDayShortcut';

/** The main button's words for each state. */
export function primaryLabel(primary: DayPrimaryAction): string {
  return primary.kind === 'gate' ? primary.label : 'Next day';
}

export interface DayControlProps {
  /** The gates waiting today, from `sim.pendingGates`. */
  readonly gates: readonly GateHit[];
  /** Phone top bar: the main button only. Skip days moves into the status sheet. */
  readonly compact?: boolean;
  /** Opens the Skip days sheet. */
  readonly onOpenSkip: () => void;
  /**
   * The gates shown are from before the world last moved and new ones are on their way: the
   * control is marked busy (`aria-busy`) until they arrive. False by default.
   */
  readonly refreshing?: boolean;
}

/**
 * The game's heartbeat. The main button is "Next day" until something is waiting: then it names
 * the gate ("Go to the show", "2 decisions waiting") and goes where the gate is dealt with, because a
 * day would not move anyway. Shift+N presses it from anywhere outside a text field or dialog.
 * Beside it, Skip days opens the multi-day sheet; it is off while a gate waits or days move.
 */
export function DayControl({
  gates,
  compact = false,
  onOpenSkip,
  refreshing = false,
}: DayControlProps) {
  const advance = useDayAdvance();
  const navigate = useNavigate();
  const [gatesOpen, setGatesOpen] = useState(false);
  const reasonId = useId();
  const busy = advance.running || advance.autosave.kind === 'saving';
  const { primary, skipEnabled } = deriveDayControl(gates, { advancing: busy });
  const label = primaryLabel(primary);
  // The phone top bar has room for about ten capitals beside the date, so a long gate label
  // shows a short one there. The accessible name starts with the words on screen (so voice
  // control finds it) and goes on with the full label.
  const phoneLabel = compact && primary.kind === 'gate' ? primary.phoneLabel : null;

  const { start } = advance;
  const runPrimary = useCallback(() => {
    if (primary.kind === 'next') {
      void start({ maxDays: 1 });
    } else if (primary.kind === 'gate') {
      if (primary.to === null) {
        setGatesOpen(true);
      } else {
        navigate(primary.to);
      }
    }
  }, [navigate, primary, start]);

  useDayShortcut(runPrimary, primary.kind !== 'busy');

  return (
    <div
      className={styles['dayControl']}
      data-testid="day-control"
      aria-busy={refreshing || undefined}
    >
      <LiveBugButton
        className={styles['primary']}
        shrinkable={compact}
        iconEnd={primary.kind === 'gate' ? 'chevron-right' : 'next-day'}
        busy={primary.kind === 'busy'}
        title={`${label} (${DAY_SHORTCUT})`}
        aria-label={phoneLabel === null ? undefined : `${phoneLabel}: ${label}`}
        aria-keyshortcuts={DAY_SHORTCUT}
        aria-describedby={primary.kind === 'gate' ? reasonId : undefined}
        aria-haspopup={primary.kind === 'gate' && primary.to === null ? 'dialog' : undefined}
        data-state={primary.kind}
        onClick={runPrimary}
      >
        {phoneLabel ?? label}
      </LiveBugButton>
      {primary.kind === 'gate' && (
        <VisuallyHidden>
          <span id={reasonId}>{primary.reason}</span>
        </VisuallyHidden>
      )}
      {!compact && (
        <IconButton
          icon="fast-forward"
          label="Skip days"
          variant="secondary"
          aria-haspopup="dialog"
          disabled={!skipEnabled}
          onClick={onOpenSkip}
        />
      )}
      <WaitingSheet
        open={gatesOpen}
        onClose={() => {
          setGatesOpen(false);
        }}
        gates={gates}
      />
    </div>
  );
}

interface WaitingSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly gates: readonly GateHit[];
}

/** Every gate waiting today, in the player's words, for a gate no screen handles yet. */
function WaitingSheet({ open, onClose, gates }: WaitingSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Waiting on you" size="sm">
      <p className={styles['fieldHint']}>The day can&apos;t move until these are dealt with.</p>
      <ul className={styles['gateList']}>
        {gates.map((hit) => (
          <li key={hit.gateId} className={styles['gateItem']}>
            {hit.reason}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
