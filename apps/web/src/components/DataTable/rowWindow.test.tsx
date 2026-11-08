/**
 * The windowing hook point: today every row renders, and the table already draws the spacer rows
 * a windowed body will need, sized without writing styles from script.
 */
import { render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import { useRowWindow, WINDOWING_ROW_THRESHOLD } from './rowWindow';
import type { RowWindow } from './rowWindow';
import type * as RowWindowModule from './rowWindow';
import type { ColumnDef } from './types';

const windowOverride = vi.hoisted(() => ({
  spacing: null as { readonly before: number; readonly after: number } | null,
}));

vi.mock('./rowWindow', async (importOriginal) => {
  const original = await importOriginal<typeof RowWindowModule>();
  return {
    ...original,
    useRowWindow: <Item,>(
      items: readonly Item[],
      scrollElement: Parameters<typeof original.useRowWindow>[1],
    ): RowWindow<Item> => {
      const realWindow = original.useRowWindow(items, scrollElement);
      const { spacing } = windowOverride;
      if (spacing === null) return realWindow;
      return {
        items: items.slice(1, 2),
        startIndex: 1,
        spaceBefore: spacing.before,
        spaceAfter: spacing.after,
      };
    },
  };
});

interface Item {
  readonly id: string;
  readonly name: string;
}

const items: readonly Item[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
];

const columns: readonly ColumnDef<Item>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name, card: 'title' },
];

const getRowId = (row: Item): string => row.id;

describe('useRowWindow', () => {
  it('returns every row with no spacing until windowing is switched on', () => {
    const many = Array.from({ length: WINDOWING_ROW_THRESHOLD + 50 }, (_, index) => index);
    let result: RowWindow<number> | null = null;

    function Probe() {
      const scroller = useRef<HTMLDivElement>(null);
      result = useRowWindow(many, scroller);
      return <div ref={scroller} />;
    }

    render(<Probe />);
    expect(result).toEqual({ items: many, startIndex: 0, spaceBefore: 0, spaceAfter: 0 });
  });

  it('draws sized spacer rows around a window, with no style attribute', () => {
    windowOverride.spacing = { before: 120, after: 80 };
    try {
      render(<DataTable rows={items} columns={columns} getRowId={getRowId} caption="Things" />);
      const [, body] = screen.getAllByRole('rowgroup', { hidden: true });
      const bodyRows = within(body!).getAllByRole('row', { hidden: true });
      expect(bodyRows).toHaveLength(3);
      expect(bodyRows[1]).toHaveAttribute('data-row-id', 'b');

      const spacerHeights = [bodyRows[0], bodyRows[2]].map((row) =>
        row?.querySelector('svg')?.getAttribute('height'),
      );
      expect(spacerHeights).toEqual(['120', '80']);
      expect(body!.querySelector('[style]')).toBeNull();
    } finally {
      windowOverride.spacing = null;
    }
  });
});
