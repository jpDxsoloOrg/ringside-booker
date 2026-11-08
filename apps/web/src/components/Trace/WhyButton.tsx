import { useId } from 'react';
import type { TraceValue } from '@ringside/engine';
import { IconButton } from '../Button';
import type { ButtonSize } from '../Button';
import { formatTraceValue } from './formatTraceValue';
import type { TraceDisplayUnit } from './formatTraceValue';
import type { EntityLinkRenderer } from './rows/rowTypes';
import { TracePanel } from './TracePanel';
import { useTracePanelStore } from './tracePanelStore';
import type { TraceSource } from './traceSource';

export interface WhyButtonProps {
  /** What the number is, as the player reads it: "Attendance". */
  readonly label: string;
  /** The number (or yes/no, or text) the button explains. */
  readonly value: TraceValue;
  /** How to show the value in the button's name. */
  readonly unit?: TraceDisplayUnit;
  /** The trace, or the reference to fetch it by. */
  readonly source: TraceSource;
  /** The panel's heading. The label by default. */
  readonly panelTitle?: string;
  /** Draws the names of entities that inputs point at. Plain text by default. */
  readonly renderEntityLink?: EntityLinkRenderer;
  /** `sm` by default, to sit beside a number. */
  readonly size?: ButtonSize;
  readonly className?: string;
}

/** The button's accessible name: `Why is Attendance 12,400 people?`. */
export function whyButtonLabel(label: string, formattedValue: string): string {
  return `Why is ${label} ${formattedValue}?`;
}

/**
 * A small help button for a derived number. It opens the "Why?" panel with the number's
 * breakdown. Only one panel is open at a time: opening another replaces it, and closing returns
 * focus to the button that opened it.
 */
export function WhyButton({
  label,
  value,
  unit,
  source,
  panelTitle,
  renderEntityLink,
  size = 'sm',
  className,
}: WhyButtonProps) {
  const panelId = useId();
  const isOpen = useTracePanelStore((state) => state.openPanelId === panelId);
  const openPanel = useTracePanelStore((state) => state.openPanel);
  const closePanel = useTracePanelStore((state) => state.closePanel);

  return (
    <>
      <IconButton
        icon="help"
        size={size}
        label={whyButtonLabel(label, formatTraceValue(value, unit))}
        aria-haspopup="dialog"
        {...(className === undefined ? {} : { className })}
        onClick={() => {
          openPanel(panelId);
        }}
      />
      <TracePanel
        title={panelTitle ?? label}
        source={source}
        open={isOpen}
        onClose={() => {
          closePanel(panelId);
        }}
        {...(renderEntityLink === undefined ? {} : { renderEntityLink })}
      />
    </>
  );
}
