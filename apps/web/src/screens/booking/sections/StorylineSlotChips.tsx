/**
 * CRTV4-04's chips on a booking card slot: "Story: <name>" for each storyline the segment is
 * linked to and "Finale" when it is that storyline's finale, from `storylines.linkOptions`. Only
 * slots with links ask the engine; anything else (an open slot, no engine, a show the viewer
 * doesn't run) adds nothing.
 */
import type { SegmentId } from '@ringside/engine';
import { useOptionalEngineClient } from '@/app/engine/EngineProvider';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import type { CardSlotChip } from '@/components/CardSlot';
import type { CardSlotChipSourceProps } from '../registries/cardSlotChips';

const NONE: readonly CardSlotChip[] = [];

/** "Story: <name>" per linked storyline, each followed by "Finale" when this is its finale. */
export function storylineChips(
  linked: readonly {
    readonly storylineId: string;
    readonly name: string;
    readonly isFinale: boolean;
  }[],
): readonly CardSlotChip[] {
  return linked.flatMap((row): CardSlotChip[] => [
    { id: `story-${row.storylineId}`, kind: 'storyline', label: `Story: ${row.name}` },
    ...(row.isFinale
      ? [{ id: `finale-${row.storylineId}`, kind: 'storyline' as const, label: 'Finale' }]
      : []),
  ]);
}

function LinkedChips({
  segmentId,
  children,
}: {
  readonly segmentId: SegmentId;
  readonly children: CardSlotChipSourceProps['children'];
}) {
  const { data } = useEngineQuery('storylines.linkOptions', { segmentId });
  return <>{children(data?.kind === 'ok' ? storylineChips(data.linked) : NONE)}</>;
}

export function StorylineSlotChips({ slot, children }: CardSlotChipSourceProps) {
  const client = useOptionalEngineClient();
  const segment = slot.segment;
  if (client === null || segment === null || segment.storylineIds.length === 0) {
    return <>{children(NONE)}</>;
  }
  return (
    <LinkedChips key={segment.segmentId} segmentId={segment.segmentId}>
      {children}
    </LinkedChips>
  );
}
