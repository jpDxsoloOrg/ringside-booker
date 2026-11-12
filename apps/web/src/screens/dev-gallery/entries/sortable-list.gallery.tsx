import { useState } from 'react';
import { CardSlotDragHandle } from '@/components/CardSlot';
import { Stack } from '@/components/layout';
import { SortableItem, SortableList, useSortableHandle } from '@/components/SortableList';
import type { SortableMode, SortableMove } from '@/components/SortableList';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

interface DemoRow {
  readonly id: string;
  readonly name: string;
}

const BEATS: readonly DemoRow[] = [
  { id: 'beat-1', name: 'Staredown' },
  { id: 'beat-2', name: 'War of words' },
  { id: 'beat-3', name: 'Brawl' },
];

const SLOTS: readonly DemoRow[] = [
  { id: 'slot-1', name: 'Opener' },
  { id: 'slot-2', name: 'Midcard' },
  { id: 'slot-3', name: 'Semi-main' },
  { id: 'slot-4', name: 'Main event' },
];

function DemoGrip({ name }: { readonly name: string }) {
  const handle = useSortableHandle();
  return <CardSlotDragHandle ref={handle.ref} {...handle.props} label={`Move ${name}`} />;
}

function reorder(rows: readonly DemoRow[], move: SortableMove, mode: SortableMode): DemoRow[] {
  const next = [...rows];
  if (mode === 'swap') {
    const from = next[move.fromIndex];
    const to = next[move.toIndex];
    if (from === undefined || to === undefined) return next;
    next[move.fromIndex] = to;
    next[move.toIndex] = from;
    return next;
  }
  const [moved] = next.splice(move.fromIndex, 1);
  if (moved !== undefined) next.splice(move.toIndex, 0, moved);
  return next;
}

function DemoList({
  mode,
  initial,
}: {
  readonly mode: SortableMode;
  readonly initial: readonly DemoRow[];
}) {
  const [rows, setRows] = useState(initial);
  const names = new Map(rows.map((row) => [row.id, row.name]));
  return (
    <ol className={styles['sortableDemo']}>
      <SortableList
        ids={rows.map((row) => row.id)}
        mode={mode}
        itemName={(id) => names.get(id) ?? id}
        onMove={(move) => {
          setRows((current) => reorder(current, move, mode));
        }}
      >
        {rows.map((row) => (
          <SortableItem key={row.id} id={row.id} className={styles['sortableRow']}>
            <DemoGrip name={row.name} />
            <span>{row.name}</span>
          </SortableItem>
        ))}
      </SortableList>
    </ol>
  );
}

function SortableListDemo() {
  return (
    <Stack gap={4}>
      <p className={styles['subheading']}>Insert: the others shift</p>
      <DemoList mode="insert" initial={BEATS} />
      <p className={styles['subheading']}>Swap: two rows trade places</p>
      <DemoList mode="swap" initial={SLOTS} />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'sortable-list',
  title: 'SortableList',
  group: 'Primitives',
  notes:
    'Drag a grip, or focus it and press Space, the arrow keys and Space again (Escape cancels). Each step is announced. The second list swaps, as the booking card does.',
  render: () => <SortableListDemo />,
};
