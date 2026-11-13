import { useState } from 'react';
import type { ReactNode } from 'react';
import { PUSH_LABELS, PUSH_LEVELS } from '@ringside/engine';
import type { Push, RosterRow } from '@ringside/engine';
import { Button } from '@/components/Button';
import { formatNumber } from '@/components/format';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { Sheet } from '@/components/Sheet';
import { WAIT_FOR_DAY_TEXT } from './rosterRowActions';
import styles from './SetPush.module.css';

/** A place on the card: every push but `none`, which only crew and managers have. */
export type CardPush = Exclude<Push, 'none'>;

/** The card positions top down, as the sheet offers them. */
export const CARD_PUSHES: readonly CardPush[] = PUSH_LEVELS.filter(
  (push): push is CardPush => push !== 'none',
);

/** The radio group's name. */
export const PUSH_CHOICE_LEGEND = 'Card position';

/** "Set push — Test Name 3", or "Set push — 3 wrestlers". */
export function setPushTitle(rows: readonly Pick<RosterRow, 'ringName'>[]): string {
  const [only] = rows;
  if (rows.length === 1 && only !== undefined) return `Set push — ${only.ringName}`;
  return `Set push — ${formatNumber(rows.length)} wrestlers`;
}

/** How many of `rows` sit at each card position. */
function countsByPush(rows: readonly RosterRow[]): ReadonlyMap<Push, number> {
  const counts = new Map<Push, number>();
  for (const row of rows) counts.set(row.push, (counts.get(row.push) ?? 0) + 1);
  return counts;
}

/**
 * The position the sheet opens on: one wrestler's own push, or the one most of a selection share
 * (the higher on the card on a tie).
 */
export function initialPush(rows: readonly RosterRow[]): CardPush {
  const counts = countsByPush(rows);
  let best: CardPush = 'midCard';
  let bestCount = 0;
  for (const push of CARD_PUSHES) {
    const count = counts.get(push) ?? 0;
    if (count > bestCount) {
      best = push;
      bestCount = count;
    }
  }
  return best;
}

/** The hint under one option: "Current" and "Expects" for one wrestler, a count for several. */
function optionHint(
  push: CardPush,
  rows: readonly RosterRow[],
  counts: ReadonlyMap<Push, number>,
): string | undefined {
  const [only] = rows;
  if (rows.length === 1 && only !== undefined) {
    const hints = [
      ...(only.push === push ? ['Current'] : []),
      ...(only.expectedPush === push ? ['Expects'] : []),
    ];
    return hints.length === 0 ? undefined : hints.join(' · ');
  }
  const here = counts.get(push) ?? 0;
  return here === 0
    ? undefined
    : `${formatNumber(here)} of ${formatNumber(rows.length)} already here`;
}

export interface SetPushSheetProps {
  /** Whether the sheet is showing. */
  readonly open: boolean;
  /** The wrestlers the change is for: one from the row menu, or the ticked ones. */
  readonly rows: readonly RosterRow[];
  /** Escape, Close, Cancel or the backdrop. */
  readonly onClose: () => void;
  /** Apply with the chosen position. The screen runs it, or asks first for several. */
  readonly onApply: (push: CardPush) => void;
  /** True while the change is on its way: Apply shows it and can't be pressed again. */
  readonly pending: boolean;
  /** The engine's words for a refused change; empty when nothing was refused. */
  readonly messages: readonly string[];
  /** True while days are advancing: Apply waits, and says why. */
  readonly advancing: boolean;
  /** Shown under the choices: WRK8's preview of how the wrestlers will take the change. */
  readonly extra?: ReactNode;
}

/**
 * The push choice for one wrestler or several: the five card positions, with where the wrestler
 * is now and where they expect to be (or, for several, how many are already at each). A side
 * sheet on desktop; on a phone it opens from the bottom by itself.
 */
export function SetPushSheet({
  open,
  rows,
  onClose,
  onApply,
  pending,
  messages,
  advancing,
  extra,
}: SetPushSheetProps) {
  // The player's pick, or null for the position the sheet opens on. Cleared on each opening.
  const [picked, setPicked] = useState<CardPush | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicked(null);
  }

  const choice = picked ?? initialPush(rows);
  const counts = countsByPush(rows);
  const allThere = rows.length > 0 && (counts.get(choice) ?? 0) === rows.length;
  const options: readonly RadioOption<CardPush>[] = CARD_PUSHES.map((push) => {
    const hint = optionHint(push, rows, counts);
    return {
      value: push,
      label: PUSH_LABELS[push],
      ...(hint === undefined ? {} : { description: hint }),
    };
  });

  let note: string | null = null;
  if (advancing) note = `${WAIT_FOR_DAY_TEXT}.`;
  else if (allThere)
    note = rows.length === 1 ? "That's their push now." : 'They are all there now.';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={setPushTitle(rows)}
      side="right"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={advancing || allThere}
            onClick={() => {
              onApply(choice);
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className={styles['sheetBody']}>
        <RadioGroup
          legend={PUSH_CHOICE_LEGEND}
          options={options}
          value={choice}
          onValueChange={setPicked}
          disabled={pending}
        />
        {extra}
        {note !== null && <p className={styles['note']}>{note}</p>}
        {messages.length > 0 && (
          <div className={styles['refusal']} role="alert">
            {messages.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
