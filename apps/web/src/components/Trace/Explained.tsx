import type { TraceNode, TraceRef, TraceValue } from '@ringside/engine';
import { classNames } from '../classNames';
import { formatTraceValue } from './formatTraceValue';
import type { TraceDisplayUnit } from './formatTraceValue';
import type { EntityLinkRenderer } from './rows/rowTypes';
import styles from './Trace.module.css';
import { traceSourceOf } from './traceSource';
import type { TraceQuery } from './traceSource';
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
  /**
   * A query that builds the breakdown when the panel opens, when the screen has neither (a list
   * row's ask, say): `traceQuery('contracts.askingTerms', args, (ask) => ask.monthlyWage.trace)`.
   */
  readonly traceQuery?: TraceQuery | null;
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
  traceQuery,
  renderEntityLink,
  className,
}: ExplainedProps) {
  const source = traceSourceOf(trace, traceRef, traceQuery);
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
