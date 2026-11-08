import { memo, useCallback, useId, useMemo } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { IconButton } from '../Button';
import { classNames } from '../classNames';
import { cardLabelFor, groupCardColumns, MANY_CARD_STATS } from './cardColumns';
import type { CardColumns } from './cardColumns';
import styles from './DataTable.module.css';
import { SKELETON_KEYS } from './skeleton';
import { findSortableColumn, firstSortDirection } from './sortRows';
import type { ColumnDef, SortState } from './types';
import { startedOnInnerControl } from './viewProps';
import type { DataTableViewProps } from './viewProps';

/** `<select>` value for "no sort": the rows in the order they were given. */
const NO_SORT_VALUE = '';

interface CardSortControlProps<Row> {
  readonly columns: readonly ColumnDef<Row>[];
  readonly sort: SortState;
  readonly onSortChange: (sort: SortState) => void;
}

/** Replaces the table header on phones: a "Sort by" select and a direction toggle. */
function CardSortControl<Row>({ columns, sort, onSortChange }: CardSortControlProps<Row>) {
  const selectId = useId();
  const sortableColumns = columns.filter((column) => column.sortValue !== undefined);
  if (sortableColumns.length === 0) return null;

  const isDescending = sort?.direction === 'desc';

  return (
    <div className={styles['cardSortBar']}>
      <label htmlFor={selectId} className={styles['cardSortLabel']}>
        Sort by
      </label>
      <select
        id={selectId}
        className={styles['cardSortSelect']}
        value={sort?.columnId ?? NO_SORT_VALUE}
        onChange={(event) => {
          const column = findSortableColumn(columns, event.target.value);
          onSortChange(
            column === undefined
              ? null
              : { columnId: column.id, direction: firstSortDirection(column) },
          );
        }}
      >
        <option value={NO_SORT_VALUE}>Default order</option>
        {sortableColumns.map((column) => (
          <option key={column.id} value={column.id}>
            {column.header}
          </option>
        ))}
      </select>
      <IconButton
        icon={isDescending ? 'sort-desc' : 'sort-asc'}
        label="Sort descending"
        variant="secondary"
        aria-pressed={isDescending}
        disabled={sort === null}
        onClick={() => {
          if (sort !== null) {
            onSortChange({ columnId: sort.columnId, direction: isDescending ? 'asc' : 'desc' });
          }
        }}
      />
    </div>
  );
}

interface CardProps<Row> {
  readonly row: Row;
  readonly rowId: string;
  readonly domId: string;
  readonly cardColumns: CardColumns<Row>;
  readonly isSelected: boolean;
  readonly isInteractive: boolean;
  readonly onPress: (rowId: string) => void;
}

function CardView<Row>({
  row,
  rowId,
  domId,
  cardColumns,
  isSelected,
  isInteractive,
  onPress,
}: CardProps<Row>) {
  const { media, title, subtitles, stats, meta } = cardColumns;
  const titleId = `${domId}-title`;
  const detailsId = `${domId}-details`;

  const content: ReactNode = (
    <>
      {media !== undefined && <div className={styles['cardMedia']}>{media.cell(row)}</div>}
      <div className={styles['cardBody']}>
        {title !== undefined && (
          <p id={titleId} className={styles['cardTitle']} data-column-id={title.id}>
            {title.cell(row)}
          </p>
        )}
        <div id={detailsId} className={styles['cardDetails']}>
          {subtitles.length > 0 && (
            <p className={styles['cardSubtitle']}>
              {subtitles.map((column) => (
                <span key={column.id} data-column-id={column.id}>
                  {column.cell(row)}
                </span>
              ))}
            </p>
          )}
          {stats.length > 0 && (
            <dl
              className={classNames(
                styles['cardStats'],
                stats.length >= MANY_CARD_STATS && styles['cardStatsMany'],
              )}
            >
              {stats.map((column) => (
                <div key={column.id} className={styles['cardStat']}>
                  <dt>{cardLabelFor(column)}</dt>
                  <dd data-column-id={column.id}>{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          )}
          {meta.length > 0 && (
            <p className={styles['cardMeta']}>
              {meta.map((column) => (
                <span key={column.id} data-column-id={column.id}>
                  <span className={styles['cardMetaLabel']}>{cardLabelFor(column)}</span>{' '}
                  {column.cell(row)}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
    </>
  );

  if (!isInteractive) {
    return (
      <li id={domId} data-row-id={rowId} className={styles['cardItem']}>
        <div className={styles['card']}>{content}</div>
      </li>
    );
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (startedOnInnerControl(event.target, event.currentTarget)) return;
    onPress(rowId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPress(rowId);
    }
  };

  return (
    <li data-row-id={rowId} className={styles['cardItem']}>
      <div
        id={domId}
        role="button"
        tabIndex={0}
        aria-labelledby={title === undefined ? undefined : titleId}
        aria-describedby={detailsId}
        aria-current={isSelected || undefined}
        className={classNames(
          styles['card'],
          styles['cardInteractive'],
          isSelected && styles['cardSelected'],
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {content}
      </div>
    </li>
  );
}

/** One card, re-rendered only when its row, the columns or its selection change. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- memo() keeps the props, only the generic is lost
const Card = memo(CardView) as typeof CardView;

interface DataTableCardsProps<Row> extends DataTableViewProps<Row> {
  /** Cards are buttons when the screen handles selection or activation. */
  readonly isInteractive: boolean;
}

/** Phone layout: the same rows as a labelled list of stacked cards with a "Sort by" control. */
export function DataTableCards<Row>({
  rows,
  columns,
  getRowId,
  caption,
  sort,
  onSortChange,
  selectedRowId,
  onSelectRow,
  onActivateRow,
  rowDomId,
  emptyContent,
  loading,
  isInteractive,
}: DataTableCardsProps<Row>) {
  const cardColumns = useMemo(() => groupCardColumns(columns), [columns]);

  const pressCard = useCallback(
    (rowId: string) => {
      onSelectRow(rowId);
      onActivateRow(rowId);
    },
    [onSelectRow, onActivateRow],
  );

  if (emptyContent !== null) {
    return <div className={styles['cardsEmpty']}>{emptyContent}</div>;
  }

  return (
    <div className={styles['cards']}>
      {!loading && <CardSortControl columns={columns} sort={sort} onSortChange={onSortChange} />}
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics when list-style is none */}
      <ul
        role="list"
        aria-label={caption}
        aria-busy={loading || undefined}
        className={styles['cardList']}
      >
        {loading
          ? SKELETON_KEYS.map((skeletonKey) => (
              <li key={skeletonKey} className={styles['cardItem']}>
                <div
                  className={classNames(styles['card'], styles['cardSkeleton'])}
                  aria-hidden="true"
                >
                  <span className={styles['skeleton']} />
                  <span className={styles['skeleton']} />
                </div>
              </li>
            ))
          : rows.map((row) => {
              const rowId = getRowId(row);
              return (
                <Card
                  key={rowId}
                  row={row}
                  rowId={rowId}
                  domId={rowDomId(rowId)}
                  cardColumns={cardColumns}
                  isSelected={rowId === selectedRowId}
                  isInteractive={isInteractive}
                  onPress={pressCard}
                />
              );
            })}
      </ul>
    </div>
  );
}
