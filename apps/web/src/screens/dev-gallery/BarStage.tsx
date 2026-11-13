import type { FocusEvent, ReactNode } from 'react';
import { classNames } from '@/components/classNames';
import broadcast from './entries/broadcast.module.css';

/**
 * On a phone the desktop bar scrolls sideways inside its stage. Chromium leaves a control that is
 * already partly in view where it is when Tab reaches it, so a button half scrolled off one edge
 * would keep its focus ring cut off. Scroll the focused control fully into view; the stage's
 * scroll padding leaves room for the ring.
 */
function revealFocusedControl(event: FocusEvent<HTMLDivElement>) {
  event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** The desktop top bar at its real width, on a dark stage it scrolls inside on a phone. */
export function BarStage({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className={classNames(broadcast['stage'], broadcast['barDemo'])}
      onFocus={revealFocusedControl}
    >
      {children}
    </div>
  );
}
