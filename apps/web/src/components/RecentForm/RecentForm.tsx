import type { ReactNode } from 'react';
import type { MatchResultForSide, RecentFormRow, TraceRef } from '@ringside/engine';
import { useEntityLinkRenderer } from '@/app/entityLinks';
import { Badge } from '../Badge';
import { classNames } from '../classNames';
import { DataTable } from '../DataTable';
import type { ColumnDef } from '../DataTable';
import { DeltaChip } from '../DeltaChip';
import { EmptyState } from '../EmptyState';
import { formatGameDate, formatSigned } from '../format';
import type { Tone } from '../tone';
import { WhyButton } from '../Trace';
import type { EntityLinkRenderer } from '../Trace';
import styles from './RecentForm.module.css';

/** One match of a recent-form list: what `match.recentForm` gives per row. */
export type RecentFormItem = Pick<
  RecentFormRow,
  | 'segmentId'
  | 'date'
  | 'eventName'
  | 'result'
  | 'opponents'
  | 'popularityChange'
  | 'momentumChange'
  | 'traceRefs'
>;

export type RecentFormVariant = 'strip' | 'list';

export interface RecentFormProps {
  /** Newest first. */
  readonly items: readonly RecentFormItem[];
  /** `strip`: up to ten W / L / D / NC pills. `list`: one row per match with the changes. */
  readonly variant: RecentFormVariant;
  /** Draws opponents' names. The `EntityLinkContext`'s by default (profile links in the game). */
  readonly renderEntityLink?: EntityLinkRenderer;
  readonly className?: string | undefined;
}

/** The most pills the strip shows. */
export const RECENT_FORM_STRIP_MAX = 10;

/** What an unknown change reads as. */
export const UNKNOWN_CHANGE = '—';

export const RESULT_LETTERS: Readonly<Record<MatchResultForSide, string>> = {
  win: 'W',
  loss: 'L',
  draw: 'D',
  noContest: 'NC',
};

export const RESULT_WORDS: Readonly<Record<MatchResultForSide, string>> = {
  win: 'Win',
  loss: 'Loss',
  draw: 'Draw',
  noContest: 'No contest',
};

/** Win positive, loss negative, the rest neutral. */
export const RESULT_TONES: Readonly<Record<MatchResultForSide, Tone>> = {
  win: 'positive',
  loss: 'negative',
  draw: 'neutral',
  noContest: 'neutral',
};

/** "Kara Voss", "Kara Voss and Rex Harlan", "Kara Voss, Rex Harlan and Vic Moreno". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

const RESULT_LINKS: Readonly<Record<MatchResultForSide, string>> = {
  win: 'against',
  loss: 'against',
  draw: 'with',
  noContest: 'with',
};

/** "Win against Kara Voss, Altura Mainstage, Jan 9, 2027": a pill's name. */
export function recentFormItemLabel(item: RecentFormItem): string {
  const names = item.opponents.map((opponent) => opponent.name);
  const against = names.length === 0 ? '' : ` ${RESULT_LINKS[item.result]} ${namesText(names)}`;
  return `${RESULT_WORDS[item.result]}${against}, ${item.eventName}, ${formatGameDate(item.date)}`;
}

function ResultPill({ result }: { readonly result: MatchResultForSide }) {
  return (
    <Badge tone={RESULT_TONES[result]} className={styles['pill']}>
      {RESULT_LETTERS[result]}
    </Badge>
  );
}

interface ChangeProps {
  readonly label: string;
  readonly change: number | null;
  readonly text: (change: number) => string;
  readonly traceRef: TraceRef | null;
}

/** A change with its Why? while the breakdown is kept, or "—" when it is not known. */
function Change({ label, change, text, traceRef }: ChangeProps) {
  if (change === null) {
    return (
      <span className={styles['unknown']} title="Not known for this match">
        {UNKNOWN_CHANGE}
      </span>
    );
  }
  const display = text(change);
  return (
    <span className={styles['change']}>
      <DeltaChip value={change} display={display} goodWhen="up" variant="plain" />
      {traceRef !== null && <WhyButton label={label} value={display} source={{ traceRef }} />}
    </span>
  );
}

function popularityText(change: number): string {
  return formatSigned(change, { maximumFractionDigits: 1 });
}

function momentumText(change: number): string {
  return formatSigned(Math.round(change));
}

function opponentsCell(item: RecentFormItem, renderEntityLink: EntityLinkRenderer): ReactNode {
  if (item.opponents.length === 0) return UNKNOWN_CHANGE;
  return item.opponents.map((opponent, index) => (
    <span key={opponent.personId}>
      {index > 0 && (index === item.opponents.length - 1 ? ' and ' : ', ')}
      {renderEntityLink({ kind: 'person', id: opponent.personId }, opponent.name)}
    </span>
  ));
}

function listColumns(renderEntityLink: EntityLinkRenderer): ColumnDef<RecentFormItem>[] {
  return [
    {
      id: 'result',
      header: 'Result',
      cell: (item) => (
        <span className={styles['resultCell']}>
          <ResultPill result={item.result} />
          <span className={styles['resultWord']}>{RESULT_WORDS[item.result]}</span>
        </span>
      ),
      width: 'sm',
      card: 'media',
    },
    {
      id: 'opponents',
      header: 'Opponents',
      cell: (item) => opponentsCell(item, renderEntityLink),
      card: 'title',
    },
    {
      id: 'event',
      header: 'Show',
      cell: (item) => item.eventName,
      card: 'subtitle',
    },
    {
      id: 'date',
      header: 'Date',
      cell: (item) => formatGameDate(item.date),
      width: 'sm',
      card: 'subtitle',
    },
    {
      id: 'popularity',
      header: 'Popularity',
      cell: (item) => (
        <Change
          label={`Popularity change at ${item.eventName}`}
          change={item.popularityChange}
          text={popularityText}
          traceRef={item.traceRefs.popularity}
        />
      ),
      numeric: true,
      card: 'stat',
    },
    {
      id: 'momentum',
      header: 'Momentum',
      cell: (item) => (
        <Change
          label={`Momentum change at ${item.eventName}`}
          change={item.momentumChange}
          text={momentumText}
          traceRef={item.traceRefs.momentum}
        />
      ),
      numeric: true,
      card: 'stat',
    },
  ];
}

/**
 * A worker's last matches: a strip of result pills (W / L / D / NC, newest first) or a list with
 * each match's opponents, show and what it did to popularity and momentum, with a Why? while the
 * breakdown is kept. "No matches yet" when there are none.
 */
export function RecentForm({ items, variant, renderEntityLink, className }: RecentFormProps) {
  const contextRenderer = useEntityLinkRenderer();
  const renderLink = renderEntityLink ?? contextRenderer;

  if (items.length === 0) {
    return (
      <EmptyState
        icon="history"
        title="No matches yet"
        body="Matches show here once they have been run on a show."
        className={className}
      />
    );
  }

  if (variant === 'strip') {
    return (
      <ol
        className={classNames(styles['strip'], className)}
        aria-label="Recent results, newest first"
      >
        {items.slice(0, RECENT_FORM_STRIP_MAX).map((item) => (
          <li
            key={item.segmentId}
            aria-label={recentFormItemLabel(item)}
            title={recentFormItemLabel(item)}
          >
            <span aria-hidden="true">
              <ResultPill result={item.result} />
            </span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className={className}>
      <DataTable
        rows={items}
        columns={listColumns(renderLink)}
        getRowId={(item) => item.segmentId}
        getRowLabel={recentFormItemLabel}
        caption="Recent matches, newest first"
        sortable={false}
      />
    </div>
  );
}
