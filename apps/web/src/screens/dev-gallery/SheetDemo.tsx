import { useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Cluster, Stack } from '@/components/layout';
import { Sheet } from '@/components/Sheet';
import type { SheetPhoneHeight, SheetSide, SheetSize } from '@/components/Sheet';
import styles from './InteractiveDemos.module.css';

const SHEET_SIDES: readonly SheetSide[] = ['right', 'left', 'bottom'];
const SHEET_SIZES: readonly SheetSize[] = ['sm', 'md', 'lg'];

/** Enough rows that every size of sheet has to scroll its body. */
const NOTE_COUNT = 30;
const NOTES = Array.from(
  { length: NOTE_COUNT },
  (_, index) => `Card note ${String(index + 1)}: keep the opener short and the crowd warm.`,
);

interface OpenSheet {
  readonly side: SheetSide;
  readonly size: SheetSize;
  readonly phoneHeight?: SheetPhoneHeight;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Gallery demo: one opener per side and size. Each sheet has long content that scrolls inside
 * the sheet, a footer, and a button that opens a ConfirmDialog on top of it.
 */
export function SheetDemo() {
  const [openSheet, setOpenSheet] = useState<OpenSheet | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const closeSheet = () => {
    setOpenSheet(null);
  };

  return (
    <Stack gap={4}>
      <p className={styles['caption']}>
        On a phone every sheet opens from the bottom. Escape, the Close button or a click on the
        backdrop closes it, and focus goes back to the button that opened it.
      </p>
      {SHEET_SIDES.map((side) => (
        <Cluster key={side} gap={2}>
          <span className={styles['sideLabel']}>{capitalise(side)}</span>
          {SHEET_SIZES.map((size) => (
            <Button
              key={size}
              size="sm"
              onClick={() => {
                setOpenSheet({ side, size });
              }}
            >
              {`Open ${side} ${size}`}
            </Button>
          ))}
        </Cluster>
      ))}
      <Cluster gap={2}>
        <span className={styles['sideLabel']}>Full on a phone</span>
        <Button
          size="sm"
          onClick={() => {
            setOpenSheet({ side: 'right', size: 'lg', phoneHeight: 'full' });
          }}
        >
          Open right lg, full height on a phone
        </Button>
      </Cluster>

      <Sheet
        open={openSheet !== null}
        onClose={closeSheet}
        side={openSheet?.side ?? 'right'}
        size={openSheet?.size ?? 'md'}
        phoneHeight={openSheet?.phoneHeight ?? 'auto'}
        title={
          openSheet === null
            ? ''
            : `${capitalise(openSheet.side)} sheet (${openSheet.size}${openSheet.phoneHeight === 'full' ? ', full on a phone' : ''})`
        }
        footer={
          <>
            <Button variant="ghost" onClick={closeSheet}>
              Cancel
            </Button>
            <Button variant="primary" onClick={closeSheet}>
              Save notes
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <p className={styles['panelText']}>
            The body scrolls on its own while the header and footer stay put. Open the confirm
            dialog to check that closing it keeps the page behind locked.
          </p>
          <div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setIsConfirmOpen(true);
              }}
            >
              Release worker
            </Button>
          </div>
          <ol className={styles['noteList']}>
            {NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ol>
        </Stack>
        <ConfirmDialog
          open={isConfirmOpen}
          onClose={() => {
            setIsConfirmOpen(false);
          }}
          onConfirm={() => undefined}
          tone="danger"
          title="Release this worker?"
          body="Their contract ends today and they join the free agents."
          confirmLabel="Release"
        />
      </Sheet>
    </Stack>
  );
}
