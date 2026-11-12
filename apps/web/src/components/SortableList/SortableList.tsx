import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Announcements, DragEndEvent, UniqueIdentifier } from '@dnd-kit/core';
import {
  rectSwappingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { classNames } from '../classNames';
import { useReducedMotion } from '@/styles/useReducedMotion';
import styles from './SortableList.module.css';

/**
 * - `insert`: the dragged item lands at the drop position and the others shift (a list of beats).
 * - `swap`: the dragged item and the one it is dropped on trade places, the rest stay (a card of
 *   slots, where a gap must never travel down the list).
 */
export type SortableMode = 'insert' | 'swap';

/** A finished drag: which item moved, onto which, and both positions (0-based). */
export interface SortableMove {
  readonly activeId: string;
  readonly overId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
}

/** What an announcement is built from. Positions are 0-based; say them 1-based. */
export interface SortableMoveContext extends SortableMove {
  readonly activeName: string;
  readonly overName: string;
  readonly total: number;
  readonly mode: SortableMode;
}

export interface SortableListProps {
  /** The items' ids in their current order. */
  readonly ids: readonly string[];
  /** `insert` by default. */
  readonly mode?: SortableMode;
  /** Called once when an item is dropped somewhere else. The list does not reorder itself. */
  readonly onMove: (move: SortableMove) => void;
  /** The item's name in announcements, such as "Beat 2, War of words" or "Main event". */
  readonly itemName: (id: string) => string;
  /** What is announced after a drop. {@link defaultMoveAnnouncement} by default. */
  readonly describeMove?: (context: SortableMoveContext) => string;
  /** No item can be dragged. */
  readonly disabled?: boolean;
  readonly children: ReactNode;
}

/**
 * "Beat 2, War of words, moved to position 1 of 3", or for a swap "Main event moved to position 2,
 * swapped with Midcard".
 */
export function defaultMoveAnnouncement(context: SortableMoveContext): string {
  const position = String(context.toIndex + 1);
  if (context.mode === 'swap') {
    return `${context.activeName} moved to position ${position}, swapped with ${context.overName}`;
  }
  return `${context.activeName} moved to position ${position} of ${String(context.total)}`;
}

const ListDisabledContext = createContext(false);

/**
 * A list whose items can be reordered by dragging a handle with a pointer, or from the keyboard:
 * Space or Enter on the handle lifts the item, the arrow keys move it, Space or Enter drops it and
 * Escape puts it back. Every step is announced. Wraps dnd-kit, which only this folder imports.
 *
 * The list never reorders on its own: `onMove` reports the drop and the owner changes `ids`
 * (`insert` with an array move, `swap` by trading the two places).
 */
export function SortableList({
  ids,
  mode = 'insert',
  onMove,
  itemName,
  describeMove = defaultMoveAnnouncement,
  disabled = false,
  children,
}: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const moveOf = useCallback(
    (activeId: UniqueIdentifier, overId: UniqueIdentifier | undefined): SortableMove | null => {
      if (overId === undefined || overId === activeId) return null;
      const fromIndex = ids.indexOf(String(activeId));
      const toIndex = ids.indexOf(String(overId));
      if (fromIndex < 0 || toIndex < 0) return null;
      return { activeId: String(activeId), overId: String(overId), fromIndex, toIndex };
    },
    [ids],
  );

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) =>
        `Picked up ${itemName(String(active.id))}, position ${String(ids.indexOf(String(active.id)) + 1)} of ${String(ids.length)}.`,
      onDragOver: ({ active, over }) => {
        if (over === null) return `${itemName(String(active.id))} is not over a position.`;
        return `${itemName(String(active.id))} is over position ${String(ids.indexOf(String(over.id)) + 1)} of ${String(ids.length)}.`;
      },
      onDragEnd: ({ active, over }) => {
        const move = moveOf(active.id, over?.id);
        if (move === null) return `${itemName(String(active.id))} dropped where it was.`;
        return describeMove({
          ...move,
          activeName: itemName(move.activeId),
          overName: itemName(move.overId),
          total: ids.length,
          mode,
        });
      },
      onDragCancel: ({ active }) =>
        `Moving ${itemName(String(active.id))} was cancelled. It is back where it was.`,
    }),
    [describeMove, ids, itemName, mode, moveOf],
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    const move = moveOf(event.active.id, event.over?.id);
    if (move !== null) onMove(move);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={[...ids]}
        strategy={mode === 'swap' ? rectSwappingStrategy : verticalListSortingStrategy}
        disabled={disabled}
      >
        <ListDisabledContext.Provider value={disabled}>{children}</ListDisabledContext.Provider>
      </SortableContext>
    </DndContext>
  );
}

/** What `useSortableHandle` hands the grip: spread `props` on a button and pass `ref`. */
export interface SortableHandle {
  readonly ref: (node: HTMLElement | null) => void;
  readonly props: ButtonHTMLAttributes<HTMLButtonElement>;
  readonly isDragging: boolean;
  /** True when this item cannot be dragged (the list or the item is disabled). */
  readonly disabled: boolean;
}

const SortableHandleContext = createContext<SortableHandle | null>(null);

/** The handle of the `SortableItem` around it. Throws outside one. */
export function useSortableHandle(): SortableHandle {
  const handle = useContext(SortableHandleContext);
  if (handle === null) throw new Error('useSortableHandle must be used inside a SortableItem.');
  return handle;
}

export interface SortableItemProps {
  readonly id: string;
  /** The item can be dropped on but not picked up, such as an open slot on a card. */
  readonly dragDisabled?: boolean;
  /** `li` by default, for a list wrapped in `ol` or `ul`. */
  readonly as?: 'li' | 'div';
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/**
 * One item of a `SortableList`. Its handle (`useSortableHandle`) starts a drag. While it moves,
 * its offset is written to two custom properties (`--sortable-x`, `--sortable-y`) that the
 * module's CSS turns into a transform, so no style attribute is set from React.
 */
export function SortableItem({
  id,
  dragDisabled = false,
  as: Tag = 'li',
  className,
  children,
}: SortableItemProps) {
  const listDisabled = useContext(ListDisabledContext);
  const reducedMotion = useReducedMotion();
  const sortable = useSortable({
    id,
    disabled: { draggable: dragDisabled || listDisabled, droppable: false },
  });
  const { setNodeRef, transform, transition, isDragging } = sortable;
  const nodeRef = useRef<HTMLElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );

  const offsetX = transform?.x ?? 0;
  const offsetY = transform?.y ?? 0;
  const motion = reducedMotion ? 'none' : (transition ?? 'none');
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (node === null) return;
    node.style.setProperty('--sortable-x', `${String(offsetX)}px`);
    node.style.setProperty('--sortable-y', `${String(offsetY)}px`);
    node.style.setProperty('--sortable-transition', motion);
  }, [offsetX, offsetY, motion]);

  const handle = useMemo<SortableHandle>(
    () => ({
      ref: sortable.setActivatorNodeRef,
      props: { ...sortable.attributes, ...sortable.listeners },
      isDragging,
      disabled: dragDisabled || listDisabled,
    }),
    [
      sortable.setActivatorNodeRef,
      sortable.attributes,
      sortable.listeners,
      isDragging,
      dragDisabled,
      listDisabled,
    ],
  );

  const moving = transform !== null && (offsetX !== 0 || offsetY !== 0);
  return (
    <Tag
      ref={setRefs}
      className={classNames(
        styles['item'],
        moving && styles['moving'],
        isDragging && styles['dragging'],
        className,
      )}
      data-sortable-id={id}
      data-dragging={isDragging}
    >
      <SortableHandleContext.Provider value={handle}>{children}</SortableHandleContext.Provider>
    </Tag>
  );
}
