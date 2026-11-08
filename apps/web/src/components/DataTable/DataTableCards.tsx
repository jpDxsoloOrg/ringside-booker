import { memo, useCallback, useMemo } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { IconButton } from '../Button';
import { classNames } from '../classNames';
import { Select } from '../Select';
import type { SelectOption } from '../Select';
import { cardLabelFor, groupCardColumns, MANY_CARD_STATS } from './cardColumns';
import type { CardColumns } from './cardColumns';
import styles from './DataTable.module.css';
import { SKELETON_KEYS } from './skeleton';
import { findSortableColumn, firstSortDirection } from './sortRows';
import type { ColumnDef, SortState } from './types';
import { RowCheckbox } from './RowCheckbox';
import { startedOnInnerControl } from './viewProps';
import type { DataTableViewProps, RowChecking } from './viewProps';

/** "Sort by" value for no sort: the rows in the order they were given. */
const NO_SORT_VALUE = '__default-order';

interface CardSortControlProps<Row> {
  readonly columns: readonly ColumnDef<Row>[];
  readonly sort: SortState;
  readonly onSortChange: (sort: SortState) => void;
}

/** Replaces the table header on phones: a "Sort by" select and a direction toggle. */
function CardSortControl<Row>({ columns, sort, onSortChange }: CardSortControlProps<Row>) {
  const sortOptions = useMemo<readonly SelectOption[]>(
    () => [
      { value: NO_SORT_VALUE, label: 'Default order' },
      ...columns
        .filter((column) => column.sortValue !== undefined)
        .map((column) => ({ value: column.id, label: column.header })),
    ],
    [columns],
  );
  if (sortOptions.length === 1) return null;

  const isDescending = sort?.direction === 'desc';

  return (
    <div className={styles['cardSortBar']}>
      <Select
        label="Sort by"
        className={styles['cardSortSelect'] ?? ''}
        options={sortOptions}
        value={sort?.columnId ?? NO_SORT_VALUE}
        onValueChange={(value) => {
          const column = findSortableColumn(columns, value);
          onSortChange(
            column === undefined
              ? null
              : { columnId: column.id, direction: firstSortDirection(column) },
          );
        }}
      />
      <IconButton
        icon={isDescending ? 'sort-desc' : 'sort-asc'}
        label="Sort descending"
        variant="secondary"
        aria-pressed={isDescending}
        disabled={sort === null}
        className={styles['cardSortDirection']}
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
  /** `undefined` when the list has no checkboxes. */
  readonly isChecked: boolean | undefined;
  readonly checking: RowChecking<Row> | null;
}

function CardView<Row>({
  row,
  rowId,
  domId,
  cardColumns,
  isSelected,
  isInteractive,
  onPress,
  isChecked,
  checking,
}: CardProps<Row>) {
  const { media, title, subtitles, stats, meta } = cardColumns;

  const content: ReactNode = (
    <>
      {media !== undefined && <div className={styles['cardMedia']}>{media.cell(row)}</div>}
      <div className={styles['cardBody']}>
        {title !== undefined && (
          <p className={styles['cardTitle']} data-column-id={title.id}>
            {title.cell(row)}
          </p>
        )}
        <div className={styles['cardDetails']}>
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
                  <dd
                    data-column-id={column.id}
                    className={column.numeric === true ? 'tabular' : undefined}
                  >
                    {column.cell(row)}
                  </dd>
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

  // The checkbox is the card's sibling, not its child: a control inside a card that is itself a
  // button would be a nested interactive element. CSS places it in the card's corner.
  const checkbox =
    checking === null ? null : (
      <div className={styles['cardCheck']}>
        <RowCheckbox
          label={`Select ${checking.getRowLabel(row)}`}
          checked={isChecked === true}
          onChange={(event) => {
            checking.toggleRowChecked(rowId, event);
          }}
        />
      </div>
    );
  const itemClassName = classNames(
    styles['cardItem'],
    checking !== null && styles['cardItemCheckable'],
    isChecked === true && styles['cardItemChecked'],
  );

  if (!isInteractive) {
    return (
      <li id={domId} data-row-id={rowId} className={itemClassName}>
        <div className={styles['card']}>{content}</div>
        {checkbox}
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

  // The card is named by its own content, title first: everything it shows, so its name always
  // holds its visible text (WCAG 2.5.3, label in name). A name of the title alone left the rest
  // of the card out, and a button's children are read as one run of text anyway.
  return (
    <li data-row-id={rowId} className={itemClassName}>
      <div
        id={domId}
        role="button"
        tabIndex={0}
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
      {checkbox}
    </li>
  );
}

/** One card, re-rendered only when its row, the columns, its selection or its checkbox change. */
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
  allColumns,
  getRowId,
  caption,
  sortable,
  sort,
  onSortChange,
  checking,
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
      {!loading && sortable && (
        <CardSortControl columns={allColumns} sort={sort} onSortChange={onSortChange} />
      )}
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
                  isChecked={checking === null ? undefined : checking.checkedRowIds.has(rowId)}
                  checking={checking}
                />
              );
            })}
      </ul>
    </div>
  );
}
