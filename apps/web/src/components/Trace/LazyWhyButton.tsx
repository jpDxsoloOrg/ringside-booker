import { useId } from 'react';
import type { QueryArgs, TraceValue } from '@ringside/engine';
import { IconButton } from '../Button';
import type { ButtonSize } from '../Button';
import { formatTraceValue } from './formatTraceValue';
import type { TraceDisplayUnit } from './formatTraceValue';
import type { EntityLinkRenderer } from './rows/rowTypes';
import { TraceQueryPanel } from './TracePanel';
import { useTracePanelStore } from './tracePanelStore';
import type { TraceQueryName } from './traceSource';
import { whyButtonLabel } from './WhyButton';

export interface LazyWhyButtonProps<Name extends TraceQueryName> {
  /** What the number is, as the player reads it: "Overall". */
  readonly label: string;
  /** The number the list already shows, for the button's name. */
  readonly value: TraceValue;
  /** How to show the value in the button's name. */
  readonly unit?: TraceDisplayUnit;
  /** The engine query that builds the breakdown, such as `workers.explain`. */
  readonly queryName: Name;
  /** That query's arguments. Keep them stable while the row shows the same number. */
  readonly args: QueryArgs<Name>;
  /** The panel's heading. The label by default. */
  readonly panelTitle?: string;
  /** Draws the names of entities that inputs point at. The `EntityLinkContext`'s by default. */
  readonly renderEntityLink?: EntityLinkRenderer;
  /** `sm` by default, to sit beside a number. */
  readonly size?: ButtonSize;
  readonly className?: string;
}

/**
 * A "Why?" button for a number whose breakdown the screen does not have. It looks and behaves
 * like `WhyButton`, but the trace is only built when the panel opens: the first open runs the
 * query, later opens reuse the cached answer. Lists use it so their rows can stay plain numbers.
 *
 * It shares the one-panel-at-a-time store with `WhyButton`, so opening either closes the other.
 */
export function LazyWhyButton<Name extends TraceQueryName>({
  label,
  value,
  unit,
  queryName,
  args,
  panelTitle,
  renderEntityLink,
  size = 'sm',
  className,
}: LazyWhyButtonProps<Name>) {
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
      <TraceQueryPanel
        title={panelTitle ?? label}
        queryName={queryName}
        args={args}
        open={isOpen}
        onClose={() => {
          closePanel(panelId);
        }}
        {...(renderEntityLink === undefined ? {} : { renderEntityLink })}
      />
    </>
  );
}
