import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useIsMobile } from '@/styles/useMediaQuery';
import { IconButton } from '../Button';
import { classNames } from '../classNames';
import styles from './Sheet.module.css';
import { firstFocusableIn, useModalDialog } from './useModalDialog';

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

/**
 * A panel that slides over the page from one edge, built on the native `<dialog>` element so focus
 * is trapped inside it, Escape closes it and it sits in the top layer above everything else.
 *
 * While open it locks page scroll; when it closes, focus goes back to the control that opened it.
 * Nothing is rendered while it is closed.
 */
export function Sheet(props: SheetProps) {
  if (!props.open) return null;
  return <OpenSheet {...props} />;
}

/** The dialog itself, mounted only while the sheet is open. */
function OpenSheet({
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const isMobile = useIsMobile();
  const resolvedSide: SheetSide = responsiveSide && isMobile ? 'bottom' : side;
  const showsHandle = resolvedSide === 'bottom' && isMobile;

  useModalDialog(dialogRef, {
    onRequestClose: onClose,
    closeOnBackdrop: true,
    // The first control in the content, or else the title, so the Close button is not the
    // first thing a keyboard or screen reader user lands on.
    getInitialFocus: (dialog) =>
      firstFocusableIn(dialog.querySelector('[data-sheet-body]')) ??
      firstFocusableIn(dialog.querySelector('[data-sheet-footer]')) ??
      dialog.querySelector<HTMLElement>(`[id="${titleId}"]`),
  });

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={classNames(
        styles['sheet'],
        styles[`side-${resolvedSide}`],
        styles[`size-${size}`],
        className,
      )}
      data-side={resolvedSide}
      data-size={size}
    >
      {showsHandle && (
        // The bar spans the sheet's full width so a tap beside the handle lands on sheet content.
        // Only a tap on the dialog box itself counts as a backdrop click.
        <div className={styles['handleBar']} aria-hidden="true">
          <div className={styles['handle']} />
        </div>
      )}
      <div className={styles['header']}>
        <h2 id={titleId} className={styles['title']} tabIndex={-1}>
          {title}
        </h2>
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
    </dialog>
  );
}
