/**
 * Your promotion > Roster > Injuries (WRK6-06): who is out right now, soonest back first, from
 * `health.report` for the player's promotion. A table on desktop; on a phone each row is a card
 * with the injury under the name, the days left as the stat and the return date below.
 *
 * Opening it marks every injury the player has not seen yet as seen, which is what clears the day
 * control's "Roster" stop: it sends the report's `waitingForViewer` ids, which include waiting
 * injuries the list itself does not show (a worker whose contract ended while it waited), so the
 * stop never outlives a visit here.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ACKNOWLEDGE_MAX_INJURIES } from '@ringside/engine';
import type { HealthReport, InjuredRow, InjuryId, PersonId, PromotionId } from '@ringside/engine';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineStatus } from '@/app/engine/EngineProvider';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { workerLinkState } from '@/app/entityLinks';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { Badge } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { VisuallyHidden } from '@/components/layout';
import { useTracePanelStore, WhyButton } from '@/components/Trace';
import {
  BODY_PART_LABELS,
  daysLeftText,
  daysText,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  yesNo,
} from '@/screens/workers/health/healthText';
import styles from './InjuriesTab.module.css';

/** The profile tab the names open: the Health tab, where the injury is shown in full. */
export function healthTabUrl(personId: PersonId): string {
  return `${routes.game.worker(personId)}?tab=health`;
}

function HealthLink({ row }: { readonly row: InjuredRow }) {
  const location = useLocation();
  return (
    <Link
      to={healthTabUrl(row.personId)}
      state={workerLinkState(location)}
      className={styles['name']}
      title={row.name}
      onClick={() => {
        useTracePanelStore.setState({ openPanelId: null });
      }}
    >
      {row.name}
    </Link>
  );
}

function NameCell({ row }: { readonly row: InjuredRow }) {
  return (
    <span className={styles['nameCell']}>
      <HealthLink row={row} />
      {row.pendingNotice && (
        <Badge tone="action" variant="solid">
          New<VisuallyHidden> injury, not seen yet</VisuallyHidden>
        </Badge>
      )}
    </span>
  );
}

/** "12 days left" with the Why? for the time out behind it, when that breakdown is kept. */
function DaysLeftCell({ row }: { readonly row: InjuredRow }) {
  const daysLeft = row.daysRemaining ?? 0;
  return (
    <span className={styles['daysLeft']}>
      <span className="tabular">{daysLeftText(daysLeft)}</span>
      {row.durationTraceRef !== null && (
        <WhyButton
          label="Time out"
          value={row.daysOut}
          unit="days"
          source={{ traceRef: row.durationTraceRef }}
          buttonLabel={`Why is ${row.name} out for ${daysText(row.daysOut)}?`}
        />
      )}
    </span>
  );
}

export const INJURY_COLUMNS: readonly ColumnDef<InjuredRow>[] = [
  {
    id: 'portrait',
    header: 'Picture',
    cell: (row) => (
      <ImageSlot
        subject={{
          kind: 'person',
          id: row.personId,
          name: row.name,
          ...(row.imageRef === null ? {} : { imageRef: row.imageRef }),
        }}
        size="sm"
        decorative
      />
    ),
    width: 'xs',
    card: 'media',
  },
  {
    id: 'name',
    header: 'Name',
    cell: (row) => <NameCell row={row} />,
    sortValue: (row) => row.name,
    width: 'lg',
    card: 'title',
  },
  {
    id: 'injury',
    header: 'Injury',
    cell: (row) => row.label,
    sortValue: (row) => row.label,
    card: 'subtitle',
  },
  {
    id: 'bodyPart',
    header: 'Body part',
    cell: (row) => BODY_PART_LABELS[row.bodyPart],
    sortValue: (row) => BODY_PART_LABELS[row.bodyPart],
    card: 'subtitle',
  },
  {
    id: 'severity',
    header: 'Severity',
    cell: (row) => (
      <Badge tone={SEVERITY_TONES[row.severity]}>{SEVERITY_LABELS[row.severity]}</Badge>
    ),
    card: 'meta',
  },
  {
    id: 'since',
    header: 'Since',
    cell: (row) => formatGameDate(row.since),
    sortValue: (row) => row.since,
    card: 'hidden',
  },
  {
    id: 'backOn',
    header: 'Back on',
    cell: (row) => formatGameDate(row.expectedReturn),
    sortValue: (row) => row.expectedReturn,
    card: 'meta',
  },
  {
    id: 'daysLeft',
    header: 'Days left',
    cell: (row) => <DaysLeftCell row={row} />,
    sortValue: (row) => row.daysRemaining,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'angles',
    header: 'Can work angles',
    cardLabel: 'Angles',
    cell: (row) => yesNo(row.canWorkAngles),
    card: 'meta',
  },
];

const NO_ROWS: readonly InjuredRow[] = [];

function rowId(row: InjuredRow): string {
  return row.injuryId;
}

function rowLabel(row: InjuredRow): string {
  return row.name;
}

export interface InjuriesListProps {
  readonly rows: readonly InjuredRow[];
  readonly loading?: boolean;
  /** Forces the table or the cards, for the gallery. */
  readonly layout?: 'auto' | 'table' | 'cards';
}

/** The list itself, from rows already fetched: sorted by return date as the engine sends it. */
export function InjuriesList({ rows, loading = false, layout = 'auto' }: InjuriesListProps) {
  return (
    <DataTable
      className={styles['table']}
      rows={rows}
      columns={INJURY_COLUMNS}
      getRowId={rowId}
      getRowLabel={rowLabel}
      caption="Injured workers, soonest back first"
      loading={loading}
      layout={layout}
      emptyState={
        <EmptyState
          icon="check"
          title="Nobody is injured"
          body="Everyone on your roster is fit to work."
          size="inline"
          headingLevel={3}
        />
      }
    />
  );
}

/** Every injury the report says this player still has to see, without repeats. */
export function injuriesToAcknowledge(report: HealthReport): InjuryId[] {
  const ids = new Set<InjuryId>(report.waitingForViewer);
  for (const row of report.rows) {
    if (row.pendingNotice) ids.add(row.injuryId);
  }
  return [...ids];
}

/**
 * Marks the waiting injuries as seen once each: a ref keeps re-renders (and the refetch the
 * command causes) from sending them again. Sent in batches the command accepts. A refusal only
 * means one was seen already, so it is ignored.
 */
function useAcknowledgeOnView(report: HealthReport | undefined): void {
  const { run } = useEngineCommand('health.acknowledgeInjuries');
  const sent = useRef(new Set<InjuryId>());
  // Not while days move: the screen sits under the advance overlay, so the player has not seen an
  // injury that happens then, and marking it seen mid-skip would let the skip run on past it.
  const advancing = useEngineStatus((state) => state.advancing);
  useEffect(() => {
    if (report === undefined || advancing) return;
    const toSend = injuriesToAcknowledge(report).filter((id) => !sent.current.has(id));
    if (toSend.length === 0) return;
    for (const id of toSend) sent.current.add(id);
    const acknowledge = async (): Promise<void> => {
      for (let start = 0; start < toSend.length; start += ACKNOWLEDGE_MAX_INJURIES) {
        try {
          await run({ injuryIds: toSend.slice(start, start + ACKNOWLEDGE_MAX_INJURIES) });
        } catch {
          // A transport failure: the stop stays up and says why; nothing to show here.
        }
      }
    };
    void acknowledge();
  }, [advancing, report, run]);
}

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'The engine gave no reason.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ') || 'The engine gave no reason.';
}

export interface InjuriesTabProps {
  /** The promotion to list; the player's own when left out. */
  readonly promotionId?: PromotionId | null;
}

function InjuriesForPromotion({ promotionId }: { readonly promotionId: PromotionId }) {
  const args = useMemo(() => ({ promotionId }), [promotionId]);
  const query = useEngineQuery('health.report', args);
  useAcknowledgeOnView(query.data);

  if (query.status === 'error') {
    return (
      <EmptyState
        icon="error"
        title="Injuries can't be shown"
        body={errorText(query.error)}
        size="inline"
        headingLevel={3}
      />
    );
  }
  return (
    <div className={styles['injuries']}>
      <p className={styles['intro']}>
        Who is out, soonest back first. Open a name for their full health.
      </p>
      <InjuriesList rows={query.data?.rows ?? NO_ROWS} loading={query.status === 'loading'} />
    </div>
  );
}

export function InjuriesTab({ promotionId }: InjuriesTabProps) {
  const seatPromotionId = useSessionStore((state) => state.seat?.promotionId) ?? null;
  const shown = promotionId === undefined ? seatPromotionId : promotionId;
  if (shown === null) {
    return (
      <EmptyState
        icon="roster"
        title="You don't run a promotion"
        body="Injuries are listed for the promotion you run."
        size="inline"
        headingLevel={3}
      />
    );
  }
  return <InjuriesForPromotion promotionId={shown} />;
}
