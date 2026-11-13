import { PROMOTION_STYLE_LABELS } from '@ringside/engine';
import type { PromotionListRow } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import type { ColumnDef } from '@/components/DataTable';
import { formatNumber, roundPopularity } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import type { ImageSubject } from '@/components/ImageSlot';
import { PromotionLink } from '@/components/PromotionLink';
import { Tooltip } from '@/components/Tooltip';
import { Explained } from '@/components/Trace';
import { controlledByText, controlledByTone } from './promotionLabels';
import styles from './PromotionsScreen.module.css';

/** A promotion's crest as an image subject. */
export function crestOf(row: {
  readonly promotionId: PromotionListRow['promotionId'];
  readonly name: string;
  readonly logoRef: PromotionListRow['logoRef'];
}): ImageSubject {
  return {
    kind: 'promotion',
    id: row.promotionId,
    name: row.name,
    ...(row.logoRef === null ? {} : { imageRef: row.logoRef }),
  };
}

/** "2 titles held: World Title (Ada Lovelace), Tag Titles (vacant)". */
export function championsText(row: PromotionListRow): string {
  if (row.champions.length === 0) return 'No titles';
  return row.champions
    .map(
      (line) =>
        `${line.titleName}: ${line.holderNames.length === 0 ? 'vacant' : line.holderNames.join(' & ')}`,
    )
    .join('; ');
}

function heldCount(row: PromotionListRow): number {
  return row.champions.filter((line) => line.holderNames.length > 0).length;
}

function ChampionsCell({ row }: { readonly row: PromotionListRow }) {
  const held = heldCount(row);
  const text = championsText(row);
  return (
    <Tooltip content={text}>
      {/* A button so keyboard and touch users reach the names too; the tooltip describes it. */}
      <button type="button" className={styles['champions']}>
        {`${formatNumber(held)} ${held === 1 ? 'champion' : 'champions'}`}
      </button>
    </Tooltip>
  );
}

function PopularityCell({ row }: { readonly row: PromotionListRow }) {
  return (
    <Explained
      value={roundPopularity(row.popularity.home.value)}
      unit="points"
      label={`Popularity in ${row.homeCountry.name}`}
      trace={row.popularity.home.trace}
    />
  );
}

/**
 * The Promotions table's columns, for the desktop table and the phone cards alike. Module level,
 * so the array is the same on every render. The sortable ids are the ones the URL may carry.
 */
export const PROMOTION_COLUMNS: readonly ColumnDef<PromotionListRow>[] = [
  {
    id: 'crest',
    header: 'Crest',
    cell: (row) => <ImageSlot subject={crestOf(row)} size="sm" decorative />,
    width: 'xs',
    card: 'media',
  },
  {
    id: 'name',
    header: 'Name',
    // One line cut with an ellipsis in the table; the link keeps the whole name as its accessible
    // name and tooltip. Cards let it wrap (PromotionsScreen.module.css).
    cell: (row) => (
      <PromotionLink
        promotionId={row.promotionId}
        name={row.name}
        truncate
        className={styles['nameLink']}
      />
    ),
    sortValue: (row) => row.name,
    width: 'lg',
    card: 'title',
  },
  {
    id: 'style',
    header: 'Style',
    cell: (row) => PROMOTION_STYLE_LABELS[row.style],
    sortValue: (row) => PROMOTION_STYLE_LABELS[row.style],
    card: 'subtitle',
  },
  {
    id: 'home',
    header: 'Home',
    cell: (row) => `${row.homeRegion.name}, ${row.homeCountry.name}`,
    sortValue: (row) => `${row.homeCountry.name} ${row.homeRegion.name}`,
    card: 'meta',
  },
  {
    id: 'popularity',
    header: 'Popularity at home',
    cardLabel: 'Popularity',
    cell: (row) => <PopularityCell row={row} />,
    sortValue: (row) => row.popularity.home.value,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'prestige',
    header: 'Prestige',
    cell: (row) => formatNumber(row.prestige),
    sortValue: (row) => row.prestige,
    numeric: true,
    width: 'sm',
    card: 'stat',
  },
  {
    id: 'roster',
    header: 'Roster',
    cell: (row) => formatNumber(row.rosterCount),
    sortValue: (row) => row.rosterCount,
    numeric: true,
    width: 'sm',
    card: 'stat',
  },
  {
    id: 'size',
    header: 'Company size',
    cardLabel: 'Size',
    // ECO1's public size band (AIP1-07); the column is dropped when no row has one.
    cell: (row) => row.size?.label ?? 'Unknown',
    sortValue: (row) => row.size?.reach ?? -1,
    card: 'meta',
  },
  {
    id: 'champions',
    header: 'Champions',
    cell: (row) => <ChampionsCell row={row} />,
    sortValue: heldCount,
    card: 'meta',
  },
  {
    id: 'controlledBy',
    header: 'Run by',
    cell: (row) => (
      <Badge tone={controlledByTone(row.controlledBy)}>
        {controlledByText(row.controlledBy, row.controllerName)}
      </Badge>
    ),
    sortValue: (row) => controlledByText(row.controlledBy, row.controllerName),
    card: 'meta',
  },
];

/** The columns without Company size, for a game with no feature that supplies it. */
const PROMOTION_COLUMNS_WITHOUT_SIZE: readonly ColumnDef<PromotionListRow>[] =
  PROMOTION_COLUMNS.filter((column) => column.id !== 'size');

/** The columns to show: Company size only when some row has a size (ECO1, AIP1-07). */
export function promotionColumnsFor(
  rows: readonly PromotionListRow[],
): readonly ColumnDef<PromotionListRow>[] {
  return rows.some((row) => row.size !== null) ? PROMOTION_COLUMNS : PROMOTION_COLUMNS_WITHOUT_SIZE;
}

/** The sortable column ids, for reading the sort back from the URL. */
export const SORTABLE_PROMOTION_COLUMNS: readonly string[] = PROMOTION_COLUMNS.filter(
  (column) => column.sortValue !== undefined,
).map((column) => column.id);

/** Ties go by name, as `promotions.list` orders them. */
export function comparePromotionTies(left: PromotionListRow, right: PromotionListRow): number {
  return left.name.localeCompare(right.name, 'en', { numeric: true });
}
