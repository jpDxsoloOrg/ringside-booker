import { useState } from 'react';
import type {
  BookingSectionView,
  BookingSegmentView,
  BookingSlotView,
  ContentKey,
  FinishOption,
  MatchCatalog,
  MatchOutcome,
  SegmentId,
} from '@ringside/engine';
import { isContentKey, parseContentKey } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { IconButton } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DropdownMenu } from '@/components/DropdownMenu';
import type { DropdownMenuAction, DropdownMenuEntry } from '@/components/DropdownMenu';
import styles from './Booking.module.css';

/**
 * The way of winning the quick Winner menu plans: the match type's first method that can move a
 * title (from its finishes, in their order), else its first method, else the catalog's first
 * title-changing method. The segment editor (EVT2-06) lets the booker pick another.
 */
export function defaultWinMethodKey(
  finishes: readonly Pick<FinishOption, 'methods'>[] | undefined,
  catalog: MatchCatalog | undefined,
): ContentKey | null {
  const typeMethods = (finishes ?? []).flatMap((finish) => finish.methods);
  const fromType = typeMethods.find((method) => method.changesTitles) ?? typeMethods[0];
  if (fromType !== undefined) return fromType.key;
  const visible = [...(catalog?.methods ?? [])]
    .filter((method) => !method.hidden)
    .sort((left, right) => left.order - right.order);
  return (visible.find((method) => method.changesTitles) ?? visible[0])?.key ?? null;
}

/** Where a filled slot can move within its section: the slot before and after, open or not. */
export function neighbourSlots(
  slot: BookingSlotView,
  section: BookingSectionView,
): { readonly up: BookingSlotView | null; readonly down: BookingSlotView | null } {
  const index = section.slots.findIndex((other) => other.slot === slot.slot);
  return {
    up: section.slots[index - 1] ?? null,
    down: section.slots[index + 1] ?? null,
  };
}

export interface SlotActionsProps {
  readonly slot: BookingSlotView;
  readonly section: BookingSectionView;
  /** Move up / Move down as visible buttons (phones) as well as in the menu. */
  readonly showMoveButtons: boolean;
  /** True when Random winners decides the show's results: no Winner menu, nothing to plan. */
  readonly randomWinners?: boolean;
  readonly onEdit: (segmentId: SegmentId) => void;
  readonly onSetResult: (segmentId: SegmentId, result: MatchOutcome) => void;
  readonly onMove: (from: BookingSlotView, to: BookingSlotView) => void;
  /** Resolves once removed; rejects with the game's reason as the error's message. */
  readonly onRemove: (segment: BookingSegmentView) => Promise<void>;
}

function sameResult(left: MatchOutcome, segment: BookingSegmentView): boolean {
  const { result } = segment;
  if (result?.kind !== left.kind) return false;
  return left.kind !== 'win' || left.winningSide === result.winningSide;
}

interface WinnerMenuInput {
  readonly segment: BookingSegmentView;
  readonly methodKey: ContentKey | null;
  readonly onSetResult: (segmentId: SegmentId, result: MatchOutcome) => void;
}

function winnerItems({ segment, methodKey, onSetResult }: WinnerMenuInput): DropdownMenuAction[] {
  const choice = (id: string, label: string, result: MatchOutcome | null): DropdownMenuAction => ({
    kind: 'item',
    id,
    label,
    disabled: result === null,
    ...(result !== null && sameResult(result, segment) ? { icon: 'check' as const } : {}),
    onSelect: () => {
      if (result !== null) onSetResult(segment.segmentId, result);
    },
  });
  return [
    ...segment.sides.map((side) =>
      choice(
        `side-${String(side.side)}`,
        `Side ${String(side.side + 1)}: ${side.name}`,
        methodKey === null ? null : { kind: 'win', winningSide: side.side, methodKey },
      ),
    ),
    choice('draw', 'Draw', { kind: 'draw' }),
    choice('no-contest', 'No contest', { kind: 'noContest' }),
  ];
}

/** Never asked for: the finishes query is off whenever the segment's type key is not valid. */
const FALLBACK_TYPE_KEY = parseContentKey('match.singles');

/** The finish data the Winner menu needs, read only for a match. */
function useWinMethod(segment: BookingSegmentView): ContentKey | null {
  const typeKey = isContentKey(segment.typeKey) ? segment.typeKey : null;
  const isMatch = segment.kind === 'match' && typeKey !== null;
  const sideCount = segment.sides.length;
  const finishes = useEngineQuery(
    'match.finishes',
    {
      matchTypeKey: typeKey ?? FALLBACK_TYPE_KEY,
      outcomeKind: 'win',
      ...(sideCount >= 2 ? { sideCount } : {}),
    },
    { enabled: isMatch },
  );
  const catalog = useEngineQuery('match.catalog', {}, { enabled: isMatch });
  return isMatch ? defaultWinMethodKey(finishes.data, catalog.data) : null;
}

interface FilledSlotActionsProps extends SlotActionsProps {
  readonly segment: BookingSegmentView;
}

function FilledSlotActions({
  slot,
  section,
  segment,
  showMoveButtons,
  randomWinners = false,
  onEdit,
  onSetResult,
  onMove,
  onRemove,
}: FilledSlotActionsProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const methodKey = useWinMethod(segment);
  const { up, down } = neighbourSlots(slot, section);
  const place = `slot ${String(slot.displayNumber)}`;

  const items: DropdownMenuEntry[] = [
    {
      kind: 'item',
      id: 'edit',
      label: 'Edit',
      icon: 'edit',
      onSelect: () => {
        onEdit(segment.segmentId);
      },
    },
  ];
  if (segment.kind === 'match' && !randomWinners) {
    items.push({
      kind: 'submenu',
      id: 'winner',
      label: 'Winner',
      icon: 'trophy',
      items: winnerItems({ segment, methodKey, onSetResult }),
    });
  }
  items.push(
    {
      kind: 'item',
      id: 'up',
      label: 'Move up',
      icon: 'up',
      disabled: up === null,
      onSelect: () => {
        if (up !== null) onMove(slot, up);
      },
    },
    {
      kind: 'item',
      id: 'down',
      label: 'Move down',
      icon: 'down',
      disabled: down === null,
      onSelect: () => {
        if (down !== null) onMove(slot, down);
      },
    },
    { kind: 'separator', id: 'danger' },
    {
      kind: 'item',
      id: 'remove',
      label: 'Remove',
      icon: 'trash',
      tone: 'danger',
      onSelect: () => {
        setConfirmingRemove(true);
      },
    },
  );

  return (
    <span className={styles['slotActions']}>
      {showMoveButtons && (
        <>
          <IconButton
            icon="up"
            label={`Move ${place} up`}
            disabled={up === null}
            className={styles['moveButton']}
            onClick={() => {
              if (up !== null) onMove(slot, up);
            }}
          />
          <IconButton
            icon="down"
            label={`Move ${place} down`}
            disabled={down === null}
            className={styles['moveButton']}
            onClick={() => {
              if (down !== null) onMove(slot, down);
            }}
          />
        </>
      )}
      <DropdownMenu
        label={`Actions for ${place}`}
        trigger={<IconButton icon="more" label={`Actions for ${place}`} size="sm" />}
        items={items}
      />
      <ConfirmDialog
        open={confirmingRemove}
        onClose={() => {
          setConfirmingRemove(false);
        }}
        onConfirm={async () => {
          await onRemove(segment);
        }}
        tone="danger"
        title={`Remove ${segment.typeName} from ${place}?`}
        body="The slot becomes open again. Nothing else on the card moves."
        confirmLabel="Remove"
        cancelLabel="Keep it"
      />
    </span>
  );
}

/**
 * A filled slot's controls: the row menu (Edit, Winner ▸, Move up, Move down, Remove) and, on a
 * phone, Move up / Move down as buttons of their own. Open slots have none; their add buttons are
 * in the slot.
 */
export function SlotActions(props: SlotActionsProps) {
  const { segment } = props.slot;
  if (segment === null) return null;
  return <FilledSlotActions {...props} segment={segment} />;
}
