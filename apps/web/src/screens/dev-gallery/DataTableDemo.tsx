import { useState } from 'react';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef, DataTableDensity, DataTableLayout } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate, formatMoney, formatSigned } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { Cluster, Stack } from '@/components/layout';
import { StatBar } from '@/components/StatBar';
import styles from './DevGalleryScreen.module.css';
import { galleryWorkers } from './fixtures/workers';
import type { GalleryWorker } from './fixtures/workers';

/** Declared once at module level, so rows only re-render when their own data changes. */
const workerColumns: readonly ColumnDef<GalleryWorker>[] = [
  {
    id: 'avatar',
    header: 'Picture',
    cell: (worker) => (
      <ImageSlot
        subject={{ kind: 'person', id: worker.id, name: worker.name }}
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
    cell: (worker) => worker.name,
    sortValue: (worker) => worker.name,
    width: 'md',
    card: 'title',
  },
  {
    id: 'role',
    header: 'Role',
    cell: (worker) => worker.role,
    sortValue: (worker) => worker.role,
    width: 'sm',
    card: 'subtitle',
  },
  {
    id: 'popularity',
    header: 'Popularity',
    cell: (worker) => <StatBar label="Popularity" hideLabel value={worker.popularity} />,
    sortValue: (worker) => worker.popularity,
    numeric: true,
    align: 'start',
    width: 'lg',
    card: 'stat',
  },
  {
    id: 'momentum',
    header: 'Momentum',
    cell: (worker) => formatSigned(worker.momentum),
    sortValue: (worker) => worker.momentum,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'age',
    header: 'Age',
    cell: (worker) => worker.age,
    sortValue: (worker) => worker.age,
    numeric: true,
    width: 'xs',
    card: 'stat',
  },
  {
    id: 'contract-end',
    header: 'Contract end',
    cardLabel: 'Contract ends',
    cell: (worker) =>
      worker.contractEnd === null ? 'No contract' : formatGameDate(worker.contractEnd),
    sortValue: (worker) => worker.contractEnd,
    width: 'sm',
    card: 'meta',
  },
  {
    id: 'wage',
    header: 'Weekly wage',
    cardLabel: 'Wage',
    cell: (worker) => formatMoney(worker.weeklyWage),
    sortValue: (worker) => worker.weeklyWage,
    numeric: true,
    card: 'stat',
  },
];

const getWorkerId = (worker: GalleryWorker): string => worker.id;

const LAYOUTS: readonly DataTableLayout[] = ['auto', 'table', 'cards'];
const DENSITIES: readonly DataTableDensity[] = ['comfortable', 'compact'];
const NO_WORKERS: readonly GalleryWorker[] = [];

interface ToggleGroupProps<Value extends string> {
  readonly label: string;
  readonly options: readonly Value[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}

function ToggleGroup<Value extends string>({
  label,
  options,
  value,
  onChange,
}: ToggleGroupProps<Value>) {
  return (
    <div role="group" aria-label={label}>
      <Cluster gap={1}>
        <span className={styles['groupLabel']} aria-hidden="true">
          {label}
        </span>
        {options.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={option === value ? 'primary' : 'secondary'}
            aria-pressed={option === value}
            onClick={() => {
              onChange(option);
            }}
          >
            {option}
          </Button>
        ))}
      </Cluster>
    </div>
  );
}

/** Gallery demo: forty placeholder workers in a DataTable, with every layout and state. */
export function DataTableDemo() {
  const [layout, setLayout] = useState<DataTableLayout>('auto');
  const [density, setDensity] = useState<DataTableDensity>('comfortable');
  const [isLoading, setIsLoading] = useState(false);
  const [isEmpty, setIsEmpty] = useState(false);
  const [openedWorker, setOpenedWorker] = useState<GalleryWorker | null>(null);

  return (
    <Stack gap={4}>
      <Cluster gap={4}>
        <ToggleGroup label="Layout" options={LAYOUTS} value={layout} onChange={setLayout} />
        <ToggleGroup label="Density" options={DENSITIES} value={density} onChange={setDensity} />
        <Cluster gap={1}>
          <Button
            size="sm"
            aria-pressed={isLoading}
            onClick={() => {
              setIsLoading((wasLoading) => !wasLoading);
            }}
          >
            Loading
          </Button>
          <Button
            size="sm"
            aria-pressed={isEmpty}
            onClick={() => {
              setIsEmpty((wasEmpty) => !wasEmpty);
            }}
          >
            Empty
          </Button>
        </Cluster>
      </Cluster>
      <p className={styles['caption']} aria-live="polite">
        {openedWorker === null
          ? 'Click a row, or select one with the arrow keys and press Enter, to open it.'
          : `Opened ${openedWorker.name}.`}
      </p>
      <DataTable
        rows={isEmpty ? NO_WORKERS : galleryWorkers}
        columns={workerColumns}
        getRowId={getWorkerId}
        caption="Roster (gallery fixtures)"
        layout={layout}
        density={density}
        loading={isLoading}
        onActivate={setOpenedWorker}
        emptyState={
          <EmptyState
            icon="search"
            title="No workers match these filters"
            body="Clear a filter to see more of the roster."
          />
        }
      />
    </Stack>
  );
}
