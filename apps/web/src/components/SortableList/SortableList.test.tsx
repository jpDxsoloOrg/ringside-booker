import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultMoveAnnouncement,
  SortableItem,
  SortableList,
  useSortableHandle,
} from './SortableList';
import type { SortableMode, SortableMove } from './SortableList';

const NAMES: Readonly<Record<string, string>> = {
  opener: 'Opener',
  midcard: 'Midcard',
  main: 'Main event',
};
const IDS = ['opener', 'midcard', 'main'];
const ROW_HEIGHT = 60;

function Grip({ name }: { readonly name: string }) {
  const handle = useSortableHandle();
  return (
    <button type="button" ref={handle.ref} {...handle.props} aria-label={`Move ${name}`}>
      grip
    </button>
  );
}

function renderList(mode: SortableMode, onMove: (move: SortableMove) => void, lockedId?: string) {
  return render(
    <ol>
      <SortableList ids={IDS} mode={mode} onMove={onMove} itemName={(id) => NAMES[id] ?? id}>
        {IDS.map((id) => (
          <SortableItem key={id} id={id} dragDisabled={id === lockedId}>
            <Grip name={NAMES[id] ?? id} />
            {NAMES[id]}
          </SortableItem>
        ))}
      </SortableList>
    </ol>,
  );
}

/** jsdom lays nothing out, so each item gets a rectangle from its place in the list. */
function rectFor(element: Element): DOMRect {
  const item = element.closest('[data-sortable-id]');
  const index = item === null ? 0 : IDS.indexOf(item.getAttribute('data-sortable-id') ?? '');
  const top = Math.max(index, 0) * ROW_HEIGHT;
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 300,
    bottom: top + ROW_HEIGHT - 10,
    width: 300,
    height: ROW_HEIGHT - 10,
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectFor(this);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function keyboardMoveDown(name: string) {
  const user = userEvent.setup();
  const grip = screen.getByRole('button', { name: `Move ${name}` });
  act(() => {
    grip.focus();
  });
  await user.keyboard('[Space]');
  await user.keyboard('[ArrowDown]');
  await user.keyboard('[Space]');
}

describe('SortableList', () => {
  it('marks each grip as a sortable handle with instructions', () => {
    renderList('insert', vi.fn());

    const grip = screen.getByRole('button', { name: 'Move Opener' });
    expect(grip).toHaveAttribute('aria-roledescription', 'sortable');
    expect(grip).toHaveAttribute('aria-describedby');
    expect(document.querySelector('[data-sortable-id] [style]')).toBeNull();
  });

  it('moves an item with the keyboard and reports the move', async () => {
    const onMove = vi.fn();
    renderList('insert', onMove);

    await keyboardMoveDown('Opener');

    await waitFor(() => {
      expect(onMove).toHaveBeenCalledWith({
        activeId: 'opener',
        overId: 'midcard',
        fromIndex: 0,
        toIndex: 1,
      });
    });
    expect(await screen.findByText('Opener moved to position 2 of 3')).toBeInTheDocument();
  });

  it('announces a swap in swap mode', async () => {
    const onMove = vi.fn();
    renderList('swap', onMove);

    await keyboardMoveDown('Midcard');

    await waitFor(() => {
      expect(onMove).toHaveBeenCalledWith({
        activeId: 'midcard',
        overId: 'main',
        fromIndex: 1,
        toIndex: 2,
      });
    });
    expect(
      await screen.findByText('Midcard moved to position 3, swapped with Main event'),
    ).toBeInTheDocument();
  });

  it('cannot pick up an item that is only a drop target', async () => {
    const onMove = vi.fn();
    renderList('swap', onMove, 'opener');

    await keyboardMoveDown('Opener');

    expect(onMove).not.toHaveBeenCalled();
  });

  it('words the default announcements', () => {
    const base = {
      activeId: 'a',
      overId: 'b',
      fromIndex: 0,
      toIndex: 1,
      activeName: 'Beat 2, War of words',
      overName: 'Beat 1, Staredown',
      total: 3,
    };
    expect(defaultMoveAnnouncement({ ...base, mode: 'insert' })).toBe(
      'Beat 2, War of words moved to position 2 of 3',
    );
    expect(defaultMoveAnnouncement({ ...base, mode: 'swap' })).toBe(
      'Beat 2, War of words moved to position 2, swapped with Beat 1, Staredown',
    );
  });
});
