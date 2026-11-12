import type { BookingCard } from '@ringside/engine';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import styles from '../Booking.module.css';
import { useSegmentEditor } from './editorStore';
import type { SegmentEditorRequest } from './editorStore';

export interface SegmentEditorSheetProps {
  /** The card the screen has loaded: the slot, the segment and its `draft` come from here. */
  readonly card: BookingCard;
}

/** The sheet's title for a request: "Add match", "Add talking segment", "Edit Singles". */
export function segmentEditorTitle(request: SegmentEditorRequest, card: BookingCard): string {
  if (request.mode === 'new') return request.kind === 'match' ? 'Add match' : 'Add talking segment';
  const segment = card.sections
    .flatMap((section) => section.slots)
    .find((slot) => slot.segment?.segmentId === request.segmentId)?.segment;
  return segment === undefined || segment === null ? 'Edit segment' : `Edit ${segment.typeName}`;
}

/**
 * The segment editor's sheet, opened from `useSegmentEditor`. This is a stand-in until the editor
 * itself (EVT2-06) replaces this file's body: it keeps the same name, props and store, so nothing
 * on the booking screen changes when the real editor lands.
 */
export function SegmentEditorSheet({ card }: SegmentEditorSheetProps) {
  const request = useSegmentEditor((state) => state.request);
  const close = useSegmentEditor((state) => state.close);
  return (
    <Sheet
      open={request !== null}
      onClose={close}
      title={request === null ? 'Segment' : segmentEditorTitle(request, card)}
      side="right"
      size="md"
      footer={<Button onClick={close}>Close</Button>}
    >
      <p className={styles['muted']}>
        The segment editor is on its way. Until it arrives, segments can't be built or changed here.
      </p>
    </Sheet>
  );
}
