import { useId } from 'react';
import type { ReactNode } from 'react';
import type { BookingSectionView, BookingSlotView } from '@ringside/engine';
import { CardSlot, CardSlotDragHandle } from '@/components/CardSlot';
import type { CardSlotIssues } from '@/components/CardSlot';
import { SortableItem, SortableList, useSortableHandle } from '@/components/SortableList';
import type { SortableMoveContext } from '@/components/SortableList';
import { Explained, WhyButton } from '@/components/Trace';
import styles from './Booking.module.css';
import { slotKey, toCardSlotProps } from './cardSlotProps';
import type { SegmentEditorKind } from './editor/editorStore';
import { WithCardSlotChips } from './registries/cardSlotChips';

/** The id of a slot's row, for scrolling to it and focusing it from the checklist. */
export function slotRowId(preShow: boolean, slot: number, prefix = 'booking-slot'): string {
  return `${prefix}-${slotKey(preShow, slot)}`;
}

/** The sortable id of whatever sits in a slot: its segment, or the open slot itself. */
function sortableIdOf(slot: BookingSlotView): string {
  return slot.segment?.segmentId ?? `open-${slotKey(slot.preShow, slot.slot)}`;
}

/** How a move was asked for: a drag (announced by the list itself) or a button or menu item. */
export type MoveSource = 'drag' | 'button';

/** "Pre-show" and "Main card": the card's two sections. */
export function sectionTitle(preShow: boolean): string {
  return preShow ? 'Pre-show' : 'Main card';
}

export interface CardBoardProps {
  /** The card's sections in running order, as `booking.card` gives them. */
  readonly sections: readonly BookingSectionView[];
  /** The problems the checks found on each slot, by `slotKey`. */
  readonly issues?: ReadonlyMap<string, CardSlotIssues>;
  /** Draws drag handles and lets rows be dragged. Off on phones and on a card that can't change. */
  readonly canReorder?: boolean;
  /**
   * A filled slot was dropped on another slot of its section: move it there (swap). The drag has
   * already announced the move, so the caller need not say it again.
   */
  readonly onMove?: (from: BookingSlotView, to: BookingSlotView, how: MoveSource) => void;
  /** An open slot's add actions. Left out, open slots show `emptyHint` and no buttons. */
  readonly onAdd?: (slot: BookingSlotView, kind: SegmentEditorKind) => void;
  /** Said in an open slot that cannot be filled, such as why the card can't change. */
  readonly emptyHint?: string;
  /** The controls at the end of a slot's header: its menu, and Move up / Move down on phones. */
  readonly renderActions?: (slot: BookingSlotView, section: BookingSectionView) => ReactNode;
  /** Starts each row's id (see `slotRowId`). Change it when two boards share a page. */
  readonly rowIdPrefix?: string;
}

function DragGrip({ label }: { readonly label: string }) {
  const handle = useSortableHandle();
  if (handle.disabled) return null;
  return <CardSlotDragHandle ref={handle.ref} {...handle.props} label={label} />;
}

/** The role's Why? and the length class chip ("Long"), never a time. */
function RoleAside({ slot }: { readonly slot: BookingSlotView }) {
  return (
    <>
      <WhyButton
        label={`slot ${String(slot.displayNumber)}'s role`}
        value={slot.roleLabel}
        panelTitle="Why this slot has its role"
        source={{ trace: slot.roleTrace }}
      />
      <span className={styles['durationChip']}>
        <Explained
          value={slot.durationLabel}
          label={`slot ${String(slot.displayNumber)}'s size`}
          trace={slot.durationTrace}
        />
      </span>
    </>
  );
}

interface SlotRowProps {
  readonly slot: BookingSlotView;
  readonly section: BookingSectionView;
  readonly props: Omit<CardBoardProps, 'sections'>;
}

function SlotRow({ slot, section, props }: SlotRowProps) {
  const view = toCardSlotProps(slot);
  const { issues, onAdd, emptyHint, renderActions, canReorder = false } = props;
  const slotIssues = issues?.get(slotKey(slot.preShow, slot.slot));
  const actions = renderActions?.(slot, section);
  const place = slot.preShow
    ? `pre-show slot ${String(slot.displayNumber)}`
    : `slot ${String(slot.displayNumber)}`;
  return (
    <div
      id={slotRowId(slot.preShow, slot.slot, props.rowIdPrefix)}
      tabIndex={-1}
      className={styles['slotRow']}
    >
      <CardSlot
        {...view}
        headingLevel={4}
        roleAside={<RoleAside slot={slot} />}
        {...(slotIssues === undefined ? {} : { issues: slotIssues })}
        {...(slot.segment?.talkLine == null
          ? {}
          : { result: <p className={styles['talkLine']}>{slot.segment.talkLine}</p> })}
        {...(canReorder && slot.segment !== null
          ? { dragHandle: <DragGrip label={`Move ${place}`} /> }
          : {})}
        {...(actions === undefined || actions === null ? {} : { actions })}
        {...(onAdd === undefined
          ? emptyHint === undefined
            ? {}
            : { emptyHint }
          : {
              onAddMatch: () => {
                onAdd(slot, 'match');
              },
              onAddPromo: () => {
                onAdd(slot, 'angle');
              },
              addPromoLabel: 'Add talking segment',
            })}
      />
      <WithCardSlotChips slot={slot}>
        {(extraChips) => (
          <CardSlot
            {...view}
            chips={extraChips.length === 0 ? view.chips : [...view.chips, ...extraChips]}
            headingLevel={4}
            roleAside={<RoleAside slot={slot} />}
            {...(slotIssues === undefined ? {} : { issues: slotIssues })}
            {...(canReorder && slot.segment !== null
              ? { dragHandle: <DragGrip label={`Move ${place}`} /> }
              : {})}
            {...(actions === undefined || actions === null ? {} : { actions })}
            {...(onAdd === undefined
              ? emptyHint === undefined
                ? {}
                : { emptyHint }
              : {
                  onAddMatch: () => {
                    onAdd(slot, 'match');
                  },
                  onAddPromo: () => {
                    onAdd(slot, 'angle');
                  },
                  addPromoLabel: 'Add talking segment',
                })}
          />
        )}
      </WithCardSlotChips>
    </div>
  );
}

function slotName(slot: BookingSlotView | undefined): string {
  if (slot === undefined) return 'Slot';
  return slot.segment === null ? `Open slot ${String(slot.displayNumber)}` : slot.roleLabel;
}

interface SectionProps {
  readonly section: BookingSectionView;
  readonly props: Omit<CardBoardProps, 'sections'>;
}

function CardSection({ section, props }: SectionProps) {
  const headingId = useId();
  const { onMove, canReorder = false } = props;
  const byId = new Map(section.slots.map((slot) => [sortableIdOf(slot), slot]));
  const ids = section.slots.map(sortableIdOf);

  const describeMove = (context: SortableMoveContext): string => {
    const target = section.slots[context.toIndex];
    const number = String(target?.displayNumber ?? context.toIndex + 1);
    if (target?.segment === null) return `${context.activeName} moved to slot ${number}`;
    return `${context.activeName} moved to slot ${number}, swapped with ${context.overName}`;
  };

  return (
    <section aria-labelledby={headingId} className={styles['cardSection']}>
      <h3 id={headingId} className={styles['sectionHeading']}>
        {sectionTitle(section.preShow)}
      </h3>
      <ol className={styles['slotList']}>
        <SortableList
          ids={ids}
          mode="swap"
          disabled={!canReorder || onMove === undefined}
          itemName={(id) => slotName(byId.get(id))}
          describeMove={describeMove}
          onMove={(move) => {
            const from = byId.get(move.activeId);
            const to = section.slots[move.toIndex];
            if (from !== undefined && to !== undefined) onMove?.(from, to, 'drag');
          }}
        >
          {section.slots.map((slot) => (
            <SortableItem
              key={sortableIdOf(slot)}
              id={sortableIdOf(slot)}
              dragDisabled={slot.segment === null}
              className={styles['slotItem']}
            >
              <SlotRow slot={slot} section={section} props={props} />
            </SortableItem>
          ))}
        </SortableList>
      </ol>
    </section>
  );
}

/**
 * The card as a column of slots, one section after another (the pre-show, then the main card).
 * Every slot of the format is listed by its role; an open slot offers its add actions. Rows trade
 * places by drag or keyboard (swap, never insert), and the caller decides what a drop does.
 */
export function CardBoard({ sections, ...props }: CardBoardProps) {
  return (
    <div className={styles['board']}>
      {sections.map((section) => (
        <CardSection key={sectionTitle(section.preShow)} section={section} props={props} />
      ))}
    </div>
  );
}
