import type { TraceNode, TraceRef, TraceValue } from '@ringside/engine';
import { classNames } from '../classNames';
import { formatTraceValue } from './formatTraceValue';
import type { TraceDisplayUnit } from './formatTraceValue';
import type { EntityLinkRenderer } from './rows/rowTypes';
import styles from './Trace.module.css';
import { traceSourceOf } from './traceSource';
import { WhyButton } from './WhyButton';

export interface ExplainedProps {
  /** The number to show. */
  readonly value: TraceValue;
  /** What the number is: names the Why? button and heads the panel. */
  readonly label: string;
  /** How to format the value. */
  readonly unit?: TraceDisplayUnit;
  /** The breakdown, when the screen already has it. */
  readonly trace?: TraceNode | null;
  /** Where to fetch the breakdown from, when the screen only has a reference. */
  readonly traceRef?: TraceRef | null;
  /** Draws the names of entities that inputs point at. The `EntityLinkContext`'s by default. */
  readonly renderEntityLink?: EntityLinkRenderer;
  readonly className?: string;
}

/**
 * A derived number with its Why? button beside it: the one element a screen needs to show an
 * explained number. With neither a trace nor a reference it shows just the number, never a
 * button that opens nothing.
 */
export function Explained({
  value,
  label,
  unit,
  trace,
  traceRef,
  renderEntityLink,
  className,
}: ExplainedProps) {
  const source = traceSourceOf(trace, traceRef);
  return (
    <span className={classNames(styles['explained'], className)}>
      <span className={classNames(styles['explainedValue'], 'tabular')}>
        {formatTraceValue(value, unit)}
      </span>
      {source !== null && (
        <WhyButton
          label={label}
          value={value}
          source={source}
          {...(unit === undefined ? {} : { unit })}
          {...(renderEntityLink === undefined ? {} : { renderEntityLink })}
        />
      )}
    </span>
  );
}
