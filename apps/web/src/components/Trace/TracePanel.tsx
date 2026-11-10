import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isFullTrace } from '@ringside/engine';
import type { QueryArgs, TraceNode, TraceRef, TraceSummary } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { VisuallyHidden } from '../layout';
import { classNames } from '../classNames';
import { formatTraceValue } from './formatTraceValue';
import type { EntityLinkRenderer } from './rows/rowTypes';
import styles from './Trace.module.css';
import {
  contributorText,
  SUMMARISED_NOTICE,
  summaryDateText,
  summaryToText,
  traceToText,
} from './traceToText';
import type { TraceQueryName, TraceSource } from './traceSource';
import { TraceTree } from './TraceTree';

export interface TracePanelProps {
  /** The sheet's heading, usually what the number is ("Attendance"). */
  readonly title: string;
  /** The trace itself, or a reference the panel fetches with `trace.get` once it opens. */
  readonly source: TraceSource;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Draws the names of entities that inputs point at. The `EntityLinkContext`'s by default. */
  readonly renderEntityLink?: EntityLinkRenderer;
}

/** Sets the panel's own spacing variables on the sheet. */
const PANEL_CLASS = styles['panel'] ?? '';

type CopyState = 'idle' | 'copied' | 'manual';

/**
 * Copies the breakdown as text. Uses the Clipboard API; where that is missing or refused, it
 * shows the text in a selected box so the player can copy it by hand. The text is only built when
 * the player asks for it, so a screen full of closed panels never writes out its traces.
 */
function CopyTextButton({ getText }: { readonly getText: () => string }) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [text, setText] = useState('');
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (copyState !== 'manual') return;
    fallbackRef.current?.focus();
    fallbackRef.current?.select();
  }, [copyState]);

  const copy = async (): Promise<void> => {
    const breakdownText = getText();
    setText(breakdownText);
    try {
      await navigator.clipboard.writeText(breakdownText);
      setCopyState('copied');
    } catch {
      setCopyState('manual');
    }
  };

  return (
    <div className={styles['copy']}>
      <div className={styles['copyActions']}>
        <span className={styles['copyStatus']} role="status">
          {copyState === 'copied' && 'Copied'}
          {copyState === 'manual' && 'Select the text and copy it'}
        </span>
        <Button
          size="sm"
          variant="secondary"
          iconStart="clipboard"
          onClick={() => {
            void copy();
          }}
        >
          Copy as text
        </Button>
      </div>
      {copyState === 'manual' && (
        <textarea
          ref={fallbackRef}
          className={styles['copyFallback']}
          aria-label="Breakdown as text"
          readOnly
          rows={6}
          value={text}
        />
      )}
    </div>
  );
}

/** What an older result keeps once its full breakdown is gone. */
export function TraceSummaryView({ summary }: { readonly summary: TraceSummary }) {
  return (
    <div className={styles['tree']}>
      <div className={styles['headline']}>
        <span className={styles['headlineLabel']}>{summary.label}</span>
        <span className={classNames(styles['headlineValue'], 'tabular')}>
          {formatTraceValue(summary.value, summary.unit)}
        </span>
      </div>
      <p className={styles['notice']} role="note">
        <Icon name="info" size="sm" decorative />
        <span>{SUMMARISED_NOTICE}</span>
      </p>
      <p className={styles['summaryDate']}>{summaryDateText(summary)}</p>
      {summary.topContributors.length > 0 && (
        <>
          <h3 className={styles['summaryHeading']}>What moved it most</h3>
          <ul className={styles['summaryList']}>
            {summary.topContributors.map((contributor) => (
              <li
                key={contributor.label}
                className={classNames(
                  styles['text'],
                  styles[contributor.effect > 0 ? 'tone-positive' : 'tone-negative'],
                )}
              >
                {contributorText(contributor, summary.unit)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TraceLoading() {
  return (
    <div className={styles['loading']} aria-busy="true">
      <VisuallyHidden>Loading the breakdown</VisuallyHidden>
      <span className={classNames(styles['skeleton'], styles['skeletonHeadline'])} />
      <span className={styles['skeleton']} />
      <span className={styles['skeleton']} />
      <span className={classNames(styles['skeleton'], styles['skeletonShort'])} />
    </div>
  );
}

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

interface TraceRefPanelProps extends Omit<TracePanelProps, 'source'> {
  readonly traceRef: TraceRef;
}

/** A panel that fetches its trace by reference once it opens. */
function TraceRefPanel({ title, traceRef, open, onClose, renderEntityLink }: TraceRefPanelProps) {
  const query = useEngineQuery('trace.get', { ref: traceRef }, { enabled: open });

  let body: ReactNode;
  let getCopyText: (() => string) | null = null;
  if (query.status === 'loading') {
    body = <TraceLoading />;
  } else if (query.status === 'error') {
    body = (
      <p className={styles['error']} role="alert">
        The breakdown could not be loaded. {errorText(query.error)}
      </p>
    );
  } else if (query.data === null || query.data === undefined) {
    body = <p className={styles['notice']}>No breakdown is kept for this result.</p>;
  } else if (isFullTrace(query.data)) {
    const { trace } = query.data;
    getCopyText = () => traceToText(trace);
    body = (
      <TraceTree
        key={`${traceRef.kind}:${traceRef.id}`}
        root={query.data.trace}
        {...(renderEntityLink === undefined ? {} : { renderEntityLink })}
      />
    );
  } else {
    const summary = query.data;
    getCopyText = () => summaryToText(summary);
    body = <TraceSummaryView summary={query.data} />;
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      side="right"
      size="md"
      className={PANEL_CLASS}
      footer={getCopyText === null ? undefined : <CopyTextButton getText={getCopyText} />}
    >
      {body}
    </Sheet>
  );
}

/**
 * `TraceQueryName` only admits queries whose answer carries a trace; this reads it back out of
 * the answer, whose exact type is not known for a query name passed as a type parameter.
 */
function hasTrace(answer: unknown): answer is { readonly trace: TraceNode } {
  return typeof answer === 'object' && answer !== null && 'trace' in answer;
}

export interface TraceQueryPanelProps<Name extends TraceQueryName> extends Omit<
  TracePanelProps,
  'source'
> {
  /** The query that builds the trace. */
  readonly queryName: Name;
  readonly args: QueryArgs<Name>;
}

/**
 * A panel whose trace is built by an engine query the first time it opens. Nothing is asked of
 * the engine while it is closed, so a list can put one beside every row.
 */
export function TraceQueryPanel<Name extends TraceQueryName>({
  title,
  queryName,
  args,
  open,
  onClose,
  renderEntityLink,
}: TraceQueryPanelProps<Name>) {
  const query = useEngineQuery(queryName, args, { enabled: open });
  const answer: unknown = query.data;

  let body: ReactNode;
  let getCopyText: (() => string) | null = null;
  if (query.status === 'loading') {
    body = <TraceLoading />;
  } else if (query.status === 'error' || !hasTrace(answer)) {
    body = (
      <p className={styles['error']} role="alert">
        The breakdown could not be loaded. {errorText(query.error)}
      </p>
    );
  } else {
    const { trace } = answer;
    getCopyText = () => traceToText(trace);
    body = (
      <TraceTree root={trace} {...(renderEntityLink === undefined ? {} : { renderEntityLink })} />
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      side="right"
      size="md"
      className={PANEL_CLASS}
      footer={getCopyText === null ? undefined : <CopyTextButton getText={getCopyText} />}
    >
      {body}
    </Sheet>
  );
}

/**
 * The "Why?" panel: a side sheet on desktop and a bottom sheet on phones that shows how a number
 * was worked out, step by step, with the final value pinned at the top. A trace passed inline
 * shows at once; a `traceRef` is fetched from the engine when the panel opens, and an older
 * result whose trace was summarised says so plainly.
 */
export function TracePanel({ title, source, open, onClose, renderEntityLink }: TracePanelProps) {
  if ('traceRef' in source) {
    return (
      <TraceRefPanel
        title={title}
        traceRef={source.traceRef}
        open={open}
        onClose={onClose}
        {...(renderEntityLink === undefined ? {} : { renderEntityLink })}
      />
    );
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      side="right"
      size="md"
      className={PANEL_CLASS}
      footer={<CopyTextButton getText={() => traceToText(source.trace)} />}
    >
      <TraceTree
        root={source.trace}
        {...(renderEntityLink === undefined ? {} : { renderEntityLink })}
      />
    </Sheet>
  );
}
