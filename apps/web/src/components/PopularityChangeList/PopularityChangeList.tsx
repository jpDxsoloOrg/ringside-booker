import { useId, useMemo, useState } from 'react';
import type {
  ShowChangeCountryView,
  ShowChangeRegionView,
  ShowChangeSummaryView,
  ShowPopularityChangeView,
  TraceNode,
  TraceRef,
} from '@ringside/engine';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { DataTable } from '../DataTable';
import type { ColumnDef, DataTableLayout } from '../DataTable';
import { DeltaChip } from '../DeltaChip';
import { formatNumber, formatPopularity, formatPopularityChange } from '../format';
import { VisuallyHidden } from '../layout';
import { traceSourceOf, WhyButton } from '../Trace';
import type { EntityLinkRenderer } from '../Trace';
import { useIsMobile } from '@/styles/useMediaQuery';
import styles from './PopularityChangeList.module.css';

/** The `popularity.showChange` answer this list draws. */
export type PopularityShowChangeView = ShowPopularityChangeView;

export interface PopularityChangeListProps {
  /** What one show did to its promotion's popularity, as `popularity.showChange` returns it. */
  readonly data: PopularityShowChangeView;
  /** Draws the names of entities inside the Why? panels. The `EntityLinkContext`'s by default. */
  readonly renderEntityLink?: EntityLinkRenderer;
  /** How many regions a phone shows before "Show all". 5 by default. */
  readonly phoneLimit?: number;
  /**
   * `auto` (the default) follows the screen: the grouped tables on desktop, the biggest changes as
   * cards below `--bp-mobile`. `table` and `cards` force one, for the gallery.
   */
  readonly layout?: DataTableLayout;
}

const DEFAULT_PHONE_LIMIT = 5;
/** Countries past this many start folded, so a worldwide show's list stays short. */
const OPEN_COUNTRIES = 3;
const POPULARITY_UNIT = 'points';

/** Popularity values and changes read as everywhere else (`components/format/popularity.ts`). */
export { formatPopularity, formatPopularityChange };

/** True when the change rounds to 0.0, so it reads as no change at all. */
export function isFlatChange(change: number): boolean {
  return formatPopularityChange(change) === '0';
}

/** The change in words, for screen readers: `up 0.2`, `down 1.5`, `no change`. */
export function changeInWords(change: number): string {
  if (isFlatChange(change)) return 'no change';
  return `${change > 0 ? 'up' : 'down'} ${formatPopularity(Math.abs(change))}`;
}

function regionsText(count: number): string {
  return `${String(count)} ${count === 1 ? 'region' : 'regions'}`;
}

/** "Fans gained in 9 regions, lost in 2, 6 about the same". */
export function summaryCountsText(summary: ShowChangeSummaryView): string {
  return (
    `Fans gained in ${regionsText(summary.regionsGained)}, ` +
    `lost in ${String(summary.regionsLost)}, ` +
    `${String(summary.regionsUnchanged)} about the same`
  );
}

interface ChangeWithWhyProps {
  readonly change: number;
  /** "Popularity change in Texas": names the Why? button and heads its panel. */
  readonly label: string;
  readonly trace?: TraceNode | null;
  readonly traceRef?: TraceRef | null;
  readonly renderEntityLink: EntityLinkRenderer | undefined;
}

/**
 * The change as a DeltaChip with its Why? beside it. The chip's arrow is only drawn, so the change
 * is also said in words ("up 0.19") for screen readers.
 */
function ChangeWithWhy({ change, label, trace, traceRef, renderEntityLink }: ChangeWithWhyProps) {
  const source = traceSourceOf(trace, traceRef);
  return (
    <span className={styles['change']}>
      <span aria-hidden="true">
        <DeltaChip
          value={change}
          display={formatPopularityChange(change)}
          goodWhen="up"
          variant="plain"
        />
      </span>
      <VisuallyHidden>{changeInWords(change)}</VisuallyHidden>
      {source !== null && (
        <WhyButton
          label={label}
          value={change}
          unit={POPULARITY_UNIT}
          source={source}
          {...(renderEntityLink === undefined ? {} : { renderEntityLink })}
        />
      )}
    </span>
  );
}

/** One region row: the region plus what the cards need from around it. */
interface RegionRow {
  readonly region: ShowChangeRegionView;
  readonly countryName: string;
  readonly score: number | null;
}

function beforeAfterText(region: ShowChangeRegionView): string {
  return `${formatPopularity(region.before)} → ${formatPopularity(region.after)}`;
}

/** "61 · scored 75": what fans there expected, against the show's score. */
function expectedText(region: ShowChangeRegionView, score: number | null): string {
  const expected = formatNumber(Math.round(region.expectation));
  return score === null ? expected : `${expected} · scored ${formatNumber(Math.round(score))}`;
}

function StatusCell({ region }: { readonly region: ShowChangeRegionView }) {
  if (region.capped) return <Badge tone="prestige">Cap reached</Badge>;
  if (isFlatChange(region.change)) {
    return <span className={styles['muted']}>About what fans expected</span>;
  }
  return null;
}

function regionColumns(
  renderEntityLink: EntityLinkRenderer | undefined,
  withCountry: boolean,
): readonly ColumnDef<RegionRow>[] {
  return [
    {
      id: 'region',
      header: 'Region',
      card: 'title',
      cell: (row) => row.region.name,
      width: 'md',
    },
    {
      id: 'seenAs',
      header: 'Seen as',
      card: 'subtitle',
      cell: (row) =>
        withCountry ? `${row.region.sourceLabel} · ${row.countryName}` : row.region.sourceLabel,
      width: 'lg',
    },
    {
      id: 'expected',
      header: 'Expected',
      card: 'meta',
      cell: (row) => expectedText(row.region, row.score),
      numeric: true,
      width: 'md',
    },
    {
      id: 'beforeAfter',
      header: 'Before → After',
      cardLabel: 'Popularity',
      card: 'meta',
      cell: (row) => beforeAfterText(row.region),
      numeric: true,
      width: 'md',
    },
    {
      id: 'change',
      header: 'Change',
      card: 'stat',
      cell: (row) => (
        <ChangeWithWhy
          change={row.region.change}
          label={`Popularity change in ${row.region.name}`}
          traceRef={row.region.traceRef}
          renderEntityLink={renderEntityLink}
        />
      ),
      numeric: true,
      width: 'md',
    },
    {
      id: 'status',
      header: 'Note',
      card: 'subtitle',
      cell: (row) => <StatusCell region={row.region} />,
      width: 'lg',
    },
  ];
}

function regionRowId(row: RegionRow): string {
  return row.region.regionId;
}

interface CountryGroupProps {
  readonly country: ShowChangeCountryView;
  readonly score: number | null;
  readonly columns: readonly ColumnDef<RegionRow>[];
  readonly startOpen: boolean;
  readonly layout: DataTableLayout;
  readonly renderEntityLink: EntityLinkRenderer | undefined;
}

/** A country's header (name, change, Why?) and its regions' table, folded when asked. */
function CountryGroup({
  country,
  score,
  columns,
  startOpen,
  layout,
  renderEntityLink,
}: CountryGroupProps) {
  const [open, setOpen] = useState(startOpen);
  const headingId = useId();
  const tableId = useId();
  const rows = useMemo(
    () => country.regions.map((region) => ({ region, countryName: country.name, score })),
    [country, score],
  );
  return (
    <section className={styles['country']} aria-labelledby={headingId}>
      <div className={styles['countryHeader']}>
        <h3 id={headingId} className={styles['countryName']}>
          {country.name}
        </h3>
        <span className={styles['countryCount']}>{regionsText(country.regions.length)}</span>
        <ChangeWithWhy
          change={country.change}
          label={`Popularity change in ${country.name}`}
          trace={country.trace}
          renderEntityLink={renderEntityLink}
        />
      </div>
      {!startOpen && (
        <Button
          variant="ghost"
          size="sm"
          iconStart={open ? 'chevron-down' : 'chevron-right'}
          aria-expanded={open}
          aria-controls={tableId}
          className={styles['fold']}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {open ? `Hide the regions in ${country.name}` : `Show the regions in ${country.name}`}
        </Button>
      )}
      <div id={tableId} hidden={!open}>
        {open && (
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={regionRowId}
            caption={`Regions in ${country.name}`}
            sortable={false}
            density="compact"
            layout={layout}
          />
        )}
      </div>
    </section>
  );
}

interface GroupedListProps {
  readonly data: PopularityShowChangeView;
  readonly layout: DataTableLayout;
  readonly renderEntityLink: EntityLinkRenderer | undefined;
  readonly id?: string;
}

function GroupedList({ data, layout, renderEntityLink, id }: GroupedListProps) {
  const columns = useMemo(() => regionColumns(renderEntityLink, false), [renderEntityLink]);
  const foldLate = data.countries.length > OPEN_COUNTRIES;
  return (
    <div className={styles['countries']} id={id}>
      {data.countries.map((country, index) => (
        <CountryGroup
          key={country.countryId}
          country={country}
          score={data.score}
          columns={columns}
          startOpen={!foldLate || index < OPEN_COUNTRIES}
          layout={layout}
          renderEntityLink={renderEntityLink}
        />
      ))}
    </div>
  );
}

interface SummaryProps {
  readonly summary: ShowChangeSummaryView;
  readonly renderEntityLink: EntityLinkRenderer | undefined;
}

function Summary({ summary, renderEntityLink }: SummaryProps) {
  const { world } = summary;
  return (
    <div className={styles['summary']}>
      <p className={styles['counts']}>{summaryCountsText(summary)}</p>
      <p className={styles['world']}>
        <span className={styles['worldLabel']}>Worldwide</span>
        <span className="tabular">
          {formatPopularity(world.before)} → {formatPopularity(world.after)}
        </span>
        <ChangeWithWhy
          change={world.change}
          label="Worldwide popularity change"
          trace={world.trace}
          renderEntityLink={renderEntityLink}
        />
      </p>
      {summary.regionsCapped > 0 && (
        <Badge tone="prestige" className={styles['capNote']}>
          {`Monthly gain cap reached in ${regionsText(summary.regionsCapped)}`}
        </Badge>
      )}
    </div>
  );
}

/** Every reached region across countries, largest change first, for the phone's short list. */
function biggestChanges(data: PopularityShowChangeView, limit: number): RegionRow[] {
  const rows = data.countries.flatMap((country) =>
    country.regions.map((region) => ({ region, countryName: country.name, score: data.score })),
  );
  return rows
    .map((row, order) => ({ row, order }))
    .sort(
      (left, right) =>
        Math.abs(right.row.region.change) - Math.abs(left.row.region.change) ||
        left.order - right.order,
    )
    .slice(0, limit)
    .map((entry) => entry.row);
}

/**
 * What one show did to its promotion's popularity: a summary (regions gained, lost and about the
 * same, the worldwide change with its Why?, the monthly cap note), then every reached region under
 * its country with how the show reached it, what fans expected against the score, before → after
 * and the change with its Why?. On a phone the biggest changes come first as cards, with "Show
 * all" for the rest. No engine calls: hand it a `popularity.showChange` answer.
 */
export function PopularityChangeList({
  data,
  renderEntityLink,
  phoneLimit = DEFAULT_PHONE_LIMIT,
  layout = 'auto',
}: PopularityChangeListProps) {
  const isMobile = useIsMobile();
  const phone = layout === 'cards' || (layout === 'auto' && isMobile);
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const topColumns = useMemo(() => regionColumns(renderEntityLink, true), [renderEntityLink]);

  const summary = data.summary;
  if (summary === null) return null;
  const regionCount = data.countries.reduce((sum, country) => sum + country.regions.length, 0);
  const shortened = phone && regionCount > phoneLimit;

  return (
    <div className={styles['list']}>
      <Summary summary={summary} renderEntityLink={renderEntityLink} />
      {shortened && !showAll && (
        <DataTable
          rows={biggestChanges(data, phoneLimit)}
          columns={topColumns}
          getRowId={regionRowId}
          caption="Biggest changes"
          sortable={false}
          layout="cards"
        />
      )}
      {shortened && (
        <Button
          variant="secondary"
          className={styles['showAll']}
          aria-expanded={showAll}
          {...(showAll ? { 'aria-controls': listId } : {})}
          onClick={() => {
            setShowAll((value) => !value);
          }}
        >
          {`Show all (${String(regionCount)})`}
        </Button>
      )}
      {(!shortened || showAll) && (
        <GroupedList data={data} layout={layout} renderEntityLink={renderEntityLink} id={listId} />
      )}
    </div>
  );
}
