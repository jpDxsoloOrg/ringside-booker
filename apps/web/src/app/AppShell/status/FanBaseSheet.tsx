import type { ReactNode } from 'react';
import { addDays, compareDates } from '@ringside/engine';
import type {
  FanBaseView,
  GameDate,
  HeadlineScope,
  OfficeSeries,
  PromotionId,
  RegionId,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { gameEntityLink } from '@/app/entityLinks';
import { DeltaChip } from '@/components/DeltaChip';
import { formatPopularity, formatPopularityChange, roundPopularity } from '@/components/format';
import { PopularityDrilldown } from '@/components/PopularityDrilldown';
import { Sheet } from '@/components/Sheet';
import { Sparkline } from '@/components/Sparkline';
import { traceSourceOf, useTracePanelStore, WhyButton } from '@/components/Trace';
import type { EntityLinkRenderer } from '@/components/Trace';
import { classNames } from '@/components/classNames';
import { useFanBaseColumns } from './fanBaseColumnRegistry';
import type { FanBaseColumnDefinition } from './fanBaseColumnRegistry';
import styles from './FanBaseSheet.module.css';

/** The sheet's title before the engine has named the promotion. */
export const FAN_BASE_TITLE = 'Fan base';

/** What the delta chip says after the change, as on the Office's cards. */
export const FAN_BASE_DELTA_SUFFIX = 'vs last week';

/** `office.trend.weeks` and `office.delta.lookbackDays` until the engine has answered. */
const DEFAULT_TREND_WEEKS = 8;
const DEFAULT_LOOKBACK_DAYS = 7;
const DAYS_PER_WEEK = 7;

/** The metric the trend reads from `office.series`. */
const HEADLINE_METRIC = 'popularity.headline';

/** "Fan base · Altura Wrestling". */
export function fanBaseTitle(name: string | undefined): string {
  return name === undefined ? FAN_BASE_TITLE : `${FAN_BASE_TITLE} · ${name}`;
}

/** Which roll-up the headline is, in words: "Shown as popularity in your home country". */
export function fanBaseScopeText(scope: HeadlineScope, own: boolean): string {
  const whose = own ? 'your' : 'its';
  switch (scope) {
    case 'homeRegion':
      return `Shown as popularity in ${whose} home region`;
    case 'homeCountry':
      return `Shown as popularity in ${whose} home country`;
    case 'homeContinent':
      return `Shown as popularity in ${whose} home continent`;
    case 'world':
      return 'Shown as popularity worldwide';
  }
}

/** The headline's line over the last weeks and its change since last week. */
export interface FanBaseTrend {
  /** Oldest first, ending with today's live value. */
  readonly values: readonly number[];
  /** Today's value minus the last record a week or more old; null when there is none. */
  readonly delta: number | null;
}

/**
 * The trend from `office.series` points: every record before today, oldest first, then the live
 * headline dated today, so the line always ends at "now" (the Office's KPI rule). The delta
 * compares with the latest record dated on or before `today − lookbackDays`.
 */
export function fanBaseTrend(
  points: OfficeSeries['points'],
  today: GameDate,
  live: number,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS,
): FanBaseTrend {
  const earlier = points.filter((point) => compareDates(point.date, today) < 0);
  const cutoff = addDays(today, -lookbackDays);
  let previous: number | null = null;
  for (const point of earlier) {
    if (compareDates(point.date, cutoff) <= 0) previous = point.value;
  }
  return {
    values: [...earlier.map((point) => point.value), live],
    delta: previous === null ? null : live - previous,
  };
}

export interface FanBaseTrendBlockProps {
  readonly trend: FanBaseTrend;
  /** How many weeks the line covers: `office.trend.weeks`. */
  readonly weeks: number;
}

/** The sparkline and the change since last week. Nothing at all with fewer than two points. */
export function FanBaseTrendBlock({ trend, weeks }: FanBaseTrendBlockProps) {
  if (trend.values.length < 2) return null;
  const period = `last ${String(weeks)} weeks`;
  return (
    <section className={styles['trend']} aria-label="Trend">
      <div className={styles['trendHeading']}>
        <span className={styles['trendLabel']}>Trend, {period}</span>
        {trend.delta !== null && (
          <DeltaChip
            value={trend.delta}
            display={formatPopularityChange(trend.delta)}
            suffix={FAN_BASE_DELTA_SUFFIX}
          />
        )}
      </div>
      <Sparkline
        className={styles['sparkline']}
        values={trend.values}
        label={`Popularity, ${period}`}
        formatValue={formatPopularity}
      />
    </section>
  );
}

export interface FanBaseDrilldownProps {
  readonly fanBase: FanBaseView;
  /** Extra figures for each region, such as the registered fan base columns. */
  readonly regionExtras?: (regionId: RegionId) => ReactNode;
  readonly renderEntityLink?: EntityLinkRenderer;
}

/**
 * WRK1's `PopularityDrilldown` for one promotion, opened on its home continent. `regionExtras` is
 * the seam the fan base column registry fills.
 */
export function FanBaseDrilldown({
  fanBase,
  regionExtras,
  renderEntityLink,
}: FanBaseDrilldownProps) {
  return (
    <PopularityDrilldown
      rollup={fanBase.rollup}
      subjectName={fanBase.name}
      initiallyOpen={[fanBase.home.continentId]}
      {...(regionExtras === undefined ? {} : { regionExtras })}
      {...(renderEntityLink === undefined ? {} : { renderEntityLink })}
    />
  );
}

/** Every registered column's figure for one region, each after its label. */
function columnExtras(
  columns: readonly FanBaseColumnDefinition[],
  promotionId: PromotionId,
): ((regionId: RegionId) => ReactNode) | undefined {
  if (columns.length === 0) return undefined;
  return (regionId) => {
    const cells = columns.flatMap((column) => {
      const content = column.render(regionId, { promotionId });
      return content === null || content === undefined || content === false
        ? []
        : [
            <span key={column.id} className={styles['column']} data-fan-base-column={column.id}>
              <span className={styles['columnLabel']}>{column.label}</span> {content}
            </span>,
          ];
    });
    return cells.length === 0 ? null : <>{cells}</>;
  };
}

export interface FanBaseBodyProps {
  readonly fanBase: FanBaseView;
  /** Whether the viewer runs this promotion: "your home country" or "its home country". */
  readonly own: boolean;
  /** The trend block, or nothing while it loads or has too few points. */
  readonly trend?: ReactNode;
  readonly renderEntityLink?: EntityLinkRenderer;
}

/** The sheet's content: the headline with its Why?, the scope in words, the trend and the map. */
export function FanBaseBody({ fanBase, own, trend, renderEntityLink }: FanBaseBodyProps) {
  const columns = useFanBaseColumns();
  const regionExtras = columnExtras(columns, fanBase.promotionId);
  const { headline } = fanBase;
  const source = traceSourceOf(null, headline.traceRef);
  return (
    <div className={styles['body']}>
      <div className={styles['headline']}>
        <span className={styles['headlineLabel']}>Popularity</span>
        <span className={styles['headlineValue']}>
          <span className="tabular">{formatPopularity(headline.value)}</span>
          {source !== null && (
            <WhyButton
              label={headline.label}
              value={roundPopularity(headline.value)}
              unit="points"
              source={source}
              renderEntityLink={renderEntityLink ?? gameEntityLink}
            />
          )}
        </span>
        <span className={styles['scope']}>
          {fanBaseScopeText(fanBase.scope, own)} ({fanBase.home.countryName})
        </span>
      </div>
      {trend}
      <FanBaseDrilldown
        fanBase={fanBase}
        renderEntityLink={renderEntityLink ?? gameEntityLink}
        {...(regionExtras === undefined ? {} : { regionExtras })}
      />
    </div>
  );
}

export interface FanBaseSheetViewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The engine's answer, or undefined while it loads or after a refusal. */
  readonly fanBase: FanBaseView | undefined;
  /** The engine's reason when it refused; null while loading. */
  readonly errorText?: string | null;
  readonly own: boolean;
  readonly trend?: ReactNode;
  readonly renderEntityLink?: EntityLinkRenderer;
}

/**
 * The Fan base sheet without the engine: a side sheet on desktop, a bottom sheet on phones. While
 * a Why? opened from inside it is showing, the sheet steps out of sight so the breakdown replaces
 * it, and closing the breakdown brings the sheet back (one panel at a time).
 */
export function FanBaseSheetView({
  open,
  onClose,
  fanBase,
  errorText = null,
  own,
  trend,
  renderEntityLink,
}: FanBaseSheetViewProps) {
  const traceOpen = useTracePanelStore((state) => state.openPanelId !== null);
  let body: ReactNode;
  if (fanBase !== undefined) {
    body = (
      <FanBaseBody
        fanBase={fanBase}
        own={own}
        trend={trend}
        {...(renderEntityLink === undefined ? {} : { renderEntityLink })}
      />
    );
  } else if (errorText !== null) {
    body = (
      <p className={styles['notice']} role="alert">
        {errorText}
      </p>
    );
  } else {
    body = (
      <p className={styles['notice']} role="status">
        Loading the fan base…
      </p>
    );
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={fanBaseTitle(fanBase?.name)}
      side="right"
      size="md"
      responsiveSide
      className={classNames(styles['sheet'], open && traceOpen && styles['behindTrace'])}
    >
      {body}
    </Sheet>
  );
}

/** The engine's reasons for refusing, in words. */
function errorTextOf(error: EngineQueryError | null): string {
  if (error === null) return 'The fan base could not be loaded.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

/** A number tunable's value from `tunables.list`, or the fallback while it loads. */
function tunableNumber(
  rows: readonly { readonly key: string; readonly value: unknown }[] | undefined,
  key: string,
  fallback: number,
): number {
  const value = rows?.find((row) => row.key === key)?.value;
  return typeof value === 'number' ? value : fallback;
}

interface ConnectedTrendProps {
  readonly fanBase: FanBaseView;
  readonly today: GameDate;
}

/** The trend block from `office.series`, asked for only once the sheet has its promotion. */
function ConnectedTrend({ fanBase, today }: ConnectedTrendProps) {
  const tunables = useEngineQuery('tunables.list', { category: 'Office' });
  const weeks = tunableNumber(tunables.data, 'office.trend.weeks', DEFAULT_TREND_WEEKS);
  const lookbackDays = tunableNumber(
    tunables.data,
    'office.delta.lookbackDays',
    DEFAULT_LOOKBACK_DAYS,
  );
  const series = useEngineQuery(
    'office.series',
    {
      subject: { kind: 'promotion', id: fanBase.promotionId },
      metric: HEADLINE_METRIC,
      from: addDays(today, -DAYS_PER_WEEK * weeks),
      to: today,
    },
    { enabled: tunables.data !== undefined },
  );
  if (series.data === undefined) return null;
  return (
    <FanBaseTrendBlock
      trend={fanBaseTrend(series.data.points, today, fanBase.headline.value, lookbackDays)}
      weeks={weeks}
    />
  );
}

export interface FanBaseSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Whose fan base: the viewer's own promotion when left out. */
  readonly promotionId?: PromotionId;
}

/**
 * "Where do my fans live?": a promotion's headline popularity with its Why?, the scope in words,
 * the headline's last weeks as a sparkline with the change since last week, and WRK1's drill-down
 * from continents to regions, opened on the home continent. The top bar's popularity chip, the
 * Office's Popularity card and the world overview all open this one sheet. It asks the engine
 * nothing while closed, so the top bar adds no query per day.
 */
export function FanBaseSheet({ open, onClose, promotionId }: FanBaseSheetProps) {
  const query = useEngineQuery('office.fanBase', promotionId === undefined ? {} : { promotionId }, {
    enabled: open,
  });
  const status = useEngineQuery('sim.status', {}, { enabled: open });
  // The last answer is kept while a new one loads; never show another promotion's under this one.
  const fanBase =
    query.data !== undefined &&
    (promotionId === undefined || query.data.promotionId === promotionId)
      ? query.data
      : undefined;
  const ownId = status.data?.promotion?.promotionId;
  const own = fanBase !== undefined && ownId === fanBase.promotionId;
  const today = status.data?.date;
  return (
    <FanBaseSheetView
      open={open}
      onClose={onClose}
      fanBase={fanBase}
      errorText={query.status === 'error' ? errorTextOf(query.error) : null}
      own={own}
      trend={
        fanBase === undefined || today === undefined ? undefined : (
          <ConnectedTrend fanBase={fanBase} today={today} />
        )
      }
    />
  );
}
