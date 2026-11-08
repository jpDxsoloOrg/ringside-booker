import { useId } from 'react';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Popover } from '../Popover';
import styles from './DataTable.module.css';
import type { ColumnDef } from './types';
import { isHideable } from './tableModel';

interface FilterFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/** A search box over every searchable column. Escape clears it. */
function FilterField({ label, value, onChange }: FilterFieldProps) {
  const inputId = useId();
  return (
    <div className={styles['filterField']}>
      <label htmlFor={inputId} className={styles['toolbarLabel']}>
        {label}
      </label>
      <div className={styles['filterInputWrap']}>
        <Icon name="search" size="sm" className={styles['filterIcon']} decorative />
        <input
          id={inputId}
          type="search"
          className={styles['filterInput']}
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && value !== '') {
              event.preventDefault();
              onChange('');
            }
          }}
        />
      </div>
    </div>
  );
}

interface ColumnPickerProps<Row> {
  readonly columns: readonly ColumnDef<Row>[];
  readonly hiddenColumnIds: readonly string[];
  readonly onColumnHiddenChange: (columnId: string, hidden: boolean) => void;
}

/** A "Columns" button that opens a checklist of the columns that can be hidden. */
function ColumnPicker<Row>({
  columns,
  hiddenColumnIds,
  onColumnHiddenChange,
}: ColumnPickerProps<Row>) {
  const hideableColumns = columns.filter(isHideable);
  if (hideableColumns.length === 0) return null;
  const hiddenCount = hiddenColumnIds.length;

  return (
    <Popover
      title="Columns"
      align="end"
      trigger={
        <Button size="sm" iconStart="layers">
          {hiddenCount === 0 ? 'Columns' : `Columns (${String(hiddenCount)} hidden)`}
        </Button>
      }
    >
      <ul className={styles['columnPickerList']}>
        {hideableColumns.map((column) => (
          <li key={column.id}>
            <label className={styles['columnPickerItem']}>
              <input
                type="checkbox"
                className={styles['checkbox']}
                checked={!hiddenColumnIds.includes(column.id)}
                onChange={(event) => {
                  onColumnHiddenChange(column.id, !event.target.checked);
                }}
              />
              <span>{column.header}</span>
            </label>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

export interface DataTableToolbarProps<Row> {
  /** Shown when `filterable` is on. */
  readonly filter: { readonly label: string; readonly value: string } | null;
  readonly onFilterChange: (value: string) => void;
  /** Shown when `columnPicker` is on. */
  readonly columnPicker: {
    readonly columns: readonly ColumnDef<Row>[];
    readonly hiddenColumnIds: readonly string[];
  } | null;
  readonly onColumnHiddenChange: (columnId: string, hidden: boolean) => void;
  /** How many rows are checked, when `selectable` is on. */
  readonly checkedCount: number | null;
  readonly onClearChecked: () => void;
  /** Rows left after the filter, announced while a filter is set. */
  readonly matchCount: number;
}

/**
 * The strip above the rows: the filter box, the column picker and the checked-row count. It sits
 * above both layouts, so a phone gets the same tools as the desktop.
 */
export function DataTableToolbar<Row>({
  filter,
  onFilterChange,
  columnPicker,
  onColumnHiddenChange,
  checkedCount,
  onClearChecked,
  matchCount,
}: DataTableToolbarProps<Row>) {
  const hasFilter = filter !== null && filter.value.trim() !== '';
  return (
    <div className={styles['toolbar']}>
      {filter !== null && (
        <FilterField label={filter.label} value={filter.value} onChange={onFilterChange} />
      )}
      <div className={styles['toolbarEnd']}>
        <p className={styles['toolbarStatus']} aria-live="polite">
          {hasFilter && (
            <span>{matchCount === 1 ? '1 match' : `${String(matchCount)} matches`}</span>
          )}
          {checkedCount !== null && checkedCount > 0 && (
            <span className={styles['checkedCount']}>{`${String(checkedCount)} selected`}</span>
          )}
        </p>
        {checkedCount !== null && checkedCount > 0 && (
          <Button size="sm" variant="ghost" onClick={onClearChecked}>
            Clear selection
          </Button>
        )}
        {columnPicker !== null && (
          <ColumnPicker
            columns={columnPicker.columns}
            hiddenColumnIds={columnPicker.hiddenColumnIds}
            onColumnHiddenChange={onColumnHiddenChange}
          />
        )}
      </div>
    </div>
  );
}
