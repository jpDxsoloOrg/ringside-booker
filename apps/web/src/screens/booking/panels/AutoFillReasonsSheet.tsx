/**
 * What Auto-fill just did (AIP4-07): "Filled N slots", one row per filled slot with its place on
 * the card, the matchup, the booker's two or three short reasons and a Why?, then the slots it
 * left open with their reasons, and the planner's message when it could book nothing. Auto-fill
 * never picks a winner, so the sheet ends by saying so. A side sheet on desktop; on a phone it
 * fills the screen. Design: docs/design/rival-booking.md#auto-fill.
 */
import type { AutoFillResult, TraceNode, TraceRef } from '@ringside/engine';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { traceSourceOf, WhyButton } from '@/components/Trace';
import styles from './AutoFill.module.css';

/** The sheet's last line. */
export const PICK_WINNERS_TEXT = 'Pick a winner for each match before you run the show.';

/** "Filled 1 slot", "Filled 6 slots", "Nothing was filled". */
export function filledTitle(count: number): string {
  if (count === 0) return 'Nothing was filled';
  return `Filled ${String(count)} ${count === 1 ? 'slot' : 'slots'}`;
}

/** "Slot 3 · Midcard", "Slot 1 · Pre-show". */
export function slotPlaceText(slot: {
  readonly displayNumber: number;
  readonly roleLabel: string;
}) {
  return `Slot ${String(slot.displayNumber)} · ${slot.roleLabel}`;
}

/** "Slot 4", "Pre-show slot 1". */
function openSlotText(slot: { readonly displayNumber: number; readonly preShow: boolean }) {
  return `${slot.preShow ? 'Pre-show slot' : 'Slot'} ${String(slot.displayNumber)}`;
}

export interface AutoFillReasonsSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly result: AutoFillResult;
  /** For the gallery, which has no engine: hands a breakdown over inline. */
  readonly traceOf?: (ref: TraceRef) => TraceNode | null;
}

export function AutoFillReasonsSheet({
  open,
  onClose,
  result,
  traceOf,
}: AutoFillReasonsSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={filledTitle(result.filled.length)}
      phoneHeight="full"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className={styles['reasons']}>
        {result.message !== null && (
          <p className={styles['message']} role="status">
            {result.message}
          </p>
        )}
        {result.filled.length > 0 && (
          <ol className={styles['filled']} aria-label="Filled slots">
            {result.filled.map((slot) => {
              const place = slotPlaceText(slot);
              const source = traceSourceOf(traceOf?.(slot.traceRef), slot.traceRef);
              return (
                <li key={slot.segmentId} className={styles['filledRow']}>
                  <div className={styles['filledHead']}>
                    <span className={styles['place']}>{place}</span>
                    {source !== null && (
                      <WhyButton
                        label={place}
                        value={slot.label}
                        buttonLabel={`Why this segment? ${place}`}
                        panelTitle={`Why this segment? ${slot.label}`}
                        source={source}
                      />
                    )}
                  </div>
                  <p className={styles['matchup']}>{slot.label}</p>
                  {slot.headline.length > 0 && (
                    <ul className={styles['headline']}>
                      {slot.headline.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {result.open.length > 0 && (
          <section className={styles['openSection']} aria-label="Left open">
            <h3 className={styles['subheading']}>Left open</h3>
            <ul className={styles['openList']}>
              {result.open.map((slot) => (
                <li key={`${slot.preShow ? 'pre' : 'main'}-${String(slot.displayNumber)}`}>
                  <span className={styles['place']}>{openSlotText(slot)}</span>
                  <span>{slot.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {result.kept > 0 && (
          <p className={styles['muted']}>
            {result.kept === 1
              ? '1 segment you had booked stayed as it was.'
              : `${String(result.kept)} segments you had booked stayed as they were.`}
          </p>
        )}
        <p className={styles['closing']}>{PICK_WINNERS_TEXT}</p>
      </div>
    </Sheet>
  );
}
