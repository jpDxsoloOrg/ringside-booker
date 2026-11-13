/**
 * The booking screen's Auto-fill panel (AIP4-07): one press lends the player the computer
 * booker's picks for the card's open slots (`aip.autoFillCard` with `keepFilledSlots: true`), or,
 * after a confirmation, for the whole card. It only suggests: every segment it writes can be
 * changed or removed like any other, it never picks a winner and it never runs the show. After a
 * press the reasons sheet lists what was booked and why. Refusals are the engine's own words.
 * Design: docs/design/rival-booking.md#auto-fill.
 */
import { useEffect, useRef, useState } from 'react';
import { CARD_FULL_MESSAGE } from '@ringside/engine';
import type { AutoFillResult, EventInstanceId } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import styles from './AutoFill.module.css';
import { AutoFillReasonsSheet } from './AutoFillReasonsSheet';

export const AUTO_FILL_HELP =
  "Fills open slots with the computer booker's picks. You still choose every winner.";
export const REBOOK_QUESTION = 'Replace every segment on this card?';

/** Which press is on its way. */
export type AutoFillPending = 'fill' | 'rebook' | null;

/** The part of a card Auto-fill's buttons look at. */
export interface AutoFillCardState {
  readonly canEdit: boolean;
  readonly editBlock: { readonly message: string } | null;
  readonly sections: readonly { readonly slots: readonly { readonly segment: unknown }[] }[];
}

/** True when the card has a slot with nothing in it. */
export function hasOpenSlot(card: Pick<AutoFillCardState, 'sections'>): boolean {
  return card.sections.some((section) => section.slots.some((slot) => slot.segment === null));
}

/**
 * Why each button cannot be pressed, or null when it can. A card that cannot change blocks both,
 * with the engine's reason; a full card only blocks filling.
 */
export function autoFillBlocks(card: AutoFillCardState): {
  readonly fill: string | null;
  readonly rebook: string | null;
} {
  if (!card.canEdit) {
    const reason = card.editBlock?.message ?? 'You cannot change this card';
    return { fill: reason, rebook: reason };
  }
  return { fill: hasOpenSlot(card) ? null : CARD_FULL_MESSAGE, rebook: null };
}

export interface AutoFillViewProps {
  /** Why Auto-fill is off, shown under the buttons; null when it can be pressed. */
  readonly fillBlock: string | null;
  /** Why Rebook is off; null when it can be pressed. */
  readonly rebookBlock: string | null;
  readonly pending?: AutoFillPending;
  /** The engine's refusal, word for word. */
  readonly refusal?: string | null;
  readonly onFill?: () => void;
  readonly onRebook?: () => void;
}

/** The panel's body: no engine access, so the gallery draws it from fixed data. */
export function AutoFillView({
  fillBlock,
  rebookBlock,
  pending = null,
  refusal = null,
  onFill,
  onRebook,
}: AutoFillViewProps) {
  const busy = pending !== null;
  const blocked = fillBlock ?? rebookBlock;
  return (
    <div className={styles['panel']}>
      <p className={styles['help']}>{AUTO_FILL_HELP}</p>
      <div className={styles['actions']}>
        <Button
          variant="primary"
          iconStart="booking"
          loading={pending === 'fill'}
          disabled={fillBlock !== null || (busy && pending !== 'fill')}
          onClick={onFill}
        >
          Auto-fill empty slots
        </Button>
        <Button
          variant="secondary"
          loading={pending === 'rebook'}
          disabled={rebookBlock !== null || (busy && pending !== 'rebook')}
          onClick={onRebook}
        >
          Rebook whole card
        </Button>
      </div>
      {blocked !== null && <p className={styles['muted']}>{blocked}</p>}
      {refusal !== null && (
        <p className={styles['error']} role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}

export interface AutoFillPanelProps {
  readonly eventInstanceId: EventInstanceId;
  readonly card: AutoFillCardState;
}

/**
 * Where focus goes when the reasons sheet closes: the panel's first button that can be pressed.
 * That is Auto-fill itself while the card has an open slot, or Rebook once Auto-fill has filled
 * every slot (a disabled button cannot hold focus). The button was disabled while the command ran,
 * so the sheet has no opener of its own to hand focus back to.
 */
export function focusPanelButton(panel: HTMLElement | null): void {
  panel?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}

/** The panel as the booking screen draws it, sending `aip.autoFillCard`. */
export function AutoFillPanel({ eventInstanceId, card }: AutoFillPanelProps) {
  const command = useEngineCommand('aip.autoFillCard');
  const [pending, setPending] = useState<AutoFillPending>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<AutoFillResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [closedSheets, setClosedSheets] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const blocks = autoFillBlocks(card);

  useEffect(() => {
    if (closedSheets > 0) focusPanelButton(panelRef.current);
  }, [closedSheets]);

  const press = async (which: Exclude<AutoFillPending, null>): Promise<void> => {
    setPending(which);
    setRefusal(null);
    try {
      const answer = await command.run({ eventInstanceId, keepFilledSlots: which === 'fill' });
      if (answer.ok) {
        setResult(answer.data);
        setSheetOpen(true);
      } else {
        setRefusal(answer.reasons.map((reason) => reason.message).join(' '));
      }
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : 'Auto-fill could not reach the game.');
    } finally {
      setPending(null);
    }
  };

  return (
    <div ref={panelRef}>
      <AutoFillView
        fillBlock={blocks.fill}
        rebookBlock={blocks.rebook}
        pending={pending}
        refusal={refusal}
        onFill={() => {
          void press('fill');
        }}
        onRebook={() => {
          setConfirming(true);
        }}
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void press('rebook');
        }}
        title={REBOOK_QUESTION}
        body="Everything on the card is taken off and the computer booker plans it again from the start. Winners stay yours to pick."
        confirmLabel="Rebook whole card"
        tone="danger"
      />
      {result !== null && (
        <AutoFillReasonsSheet
          open={sheetOpen}
          onClose={() => {
            setSheetOpen(false);
            setClosedSheets((count) => count + 1);
          }}
          result={result}
        />
      )}
    </div>
  );
}
