import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { useIsMobile } from '@/styles/useMediaQuery';
import { IconButton } from '../Button';
import { classNames } from '../classNames';
import styles from './Sheet.module.css';
import { useBodyScrollLock } from './useBodyScrollLock';
import { firstFocusableIn, useOverlayFocus } from './useOverlayFocus';

export type SheetSide = 'right' | 'left' | 'bottom';
export type SheetSize = 'sm' | 'md' | 'lg';

export interface SheetProps {
  /** Whether the sheet is showing. The parent owns this and clears it in `onClose`. */
  readonly open: boolean;
  /** Escape, the Close button or a backdrop click asked to close. Set `open` to false here. */
  readonly onClose: () => void;
  /** Heading at the top of the sheet; it also names the dialog. */
  readonly title: ReactNode;
  /** Edge the sheet slides in from on desktop. `right` by default. */
  readonly side?: SheetSide;
  /** Width of a side sheet, or the height cap of a bottom one. `md` by default. */
  readonly size?: SheetSize;
  /** Actions pinned below the scrolling body, such as Save and Cancel. */
  readonly footer?: ReactNode;
  /**
   * On phones (below `--bp-mobile`) every sheet opens from the bottom, with a drag handle, so
   * screens can ask for "a side panel" and get the right thing on each layout. True by default;
   * false keeps `side` on every screen size.
   */
  readonly responsiveSide?: boolean;
  /** Accessible name of the Close button. `Close` by default. */
  readonly closeLabel?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/** The first control in the body, then the footer, else the title. Never the Close button. */
function sheetInitialFocus(content: HTMLElement): HTMLElement | null {
  return (
    firstFocusableIn(content.querySelector('[data-sheet-body]')) ??
    firstFocusableIn(content.querySelector('[data-sheet-footer]')) ??
    content.querySelector<HTMLElement>('[data-sheet-title]')
  );
}

/**
 * A panel that slides over the page from one edge. It is a modal Radix dialog: focus is trapped
 * inside, Escape and a click on the backdrop close it, and the rest of the page is hidden from
 * screen readers while it is open.
 *
 * While open it locks page scroll; when it closes, focus goes back to the control that opened it.
 * Nothing is rendered while it is closed.
 */
export function Sheet({
  open,
  onClose,
  title,
  side = 'right',
  size = 'md',
  footer,
  responsiveSide = true,
  closeLabel = 'Close',
  className,
  children,
}: SheetProps) {
  const isMobile = useIsMobile();
  const resolvedSide: SheetSide = responsiveSide && isMobile ? 'bottom' : side;
  const showsHandle = resolvedSide === 'bottom' && isMobile;
  const focusHandlers = useOverlayFocus(open, sheetInitialFocus);
  useBodyScrollLock(open);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles['overlay']} data-sheet-overlay="" />
        <Dialog.Content
          aria-describedby={undefined}
          className={classNames(
            styles['sheet'],
            styles[`side-${resolvedSide}`],
            styles[`size-${size}`],
            className,
          )}
          data-side={resolvedSide}
          data-size={size}
          {...focusHandlers}
        >
          {showsHandle && (
            // Visual only for now. The bar spans the sheet's full width so a tap beside the
            // handle lands on the sheet, not on the backdrop.
            <div className={styles['handleBar']} aria-hidden="true">
              <div className={styles['handle']} />
            </div>
          )}
          <div className={styles['header']}>
            <Dialog.Title className={styles['title']} tabIndex={-1} data-sheet-title="">
              {title}
            </Dialog.Title>
            <IconButton icon="close" label={closeLabel} onClick={onClose} />
          </div>
          <div className={styles['body']} data-sheet-body="">
            {children}
          </div>
          {footer !== undefined && (
            <div className={styles['footer']} data-sheet-footer="">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
