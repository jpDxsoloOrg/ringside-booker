import type { ComponentType, ReactNode } from 'react';
import type { BookingSlotView } from '@ringside/engine';
import type { CardSlotChip } from '@/components/CardSlot';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';

/** What a chip source is drawn with: the slot, and where to hand its chips. */
export interface CardSlotChipSourceProps {
  readonly slot: BookingSlotView;
  /** Called with this source's chips (an empty list for none); draws the rest of the slot. */
  readonly children: (chips: readonly CardSlotChip[]) => ReactNode;
}

/**
 * Chips another feature adds to a booking card slot, after the type and title chips: CRTV4's
 * "Story: <name>" and "Finale". A component rather than a function, so a source can read the
 * engine with hooks; it must always call `children`, with `[]` when it has nothing to add.
 */
export interface CardSlotChipsDefinition {
  /** Unique, prefixed with the feature: `storylines.links`. */
  readonly id: string;
  /** Its chips' place after the built-in ones, lowest first. */
  readonly order: number;
  readonly Source: ComponentType<CardSlotChipSourceProps>;
}

const chipSources = createExtensionRegistry<CardSlotChipsDefinition>('A card slot chip source');

/**
 * Adds chips to every booking card slot without editing `CardBoard` or `CardSlot`. Returns a
 * function that removes the source again; throws when the id is taken. Register from a file
 * imported by `../sections/index.ts`.
 */
export function registerCardSlotChips(definition: CardSlotChipsDefinition): () => void {
  return chipSources.register(definition);
}

interface ChainProps {
  readonly sources: readonly CardSlotChipsDefinition[];
  readonly slot: BookingSlotView;
  readonly collected: readonly CardSlotChip[];
  readonly children: (chips: readonly CardSlotChip[]) => ReactNode;
}

/** Each source in turn adds its chips; the last one draws the slot with all of them. */
function ChipChain({ sources, slot, collected, children }: ChainProps) {
  const [first, ...rest] = sources;
  if (first === undefined) return <>{children(collected)}</>;
  const { Source } = first;
  return (
    <Source key={first.id} slot={slot}>
      {(chips) => (
        <ChipChain sources={rest} slot={slot} collected={[...collected, ...chips]}>
          {children}
        </ChipChain>
      )}
    </Source>
  );
}

export interface WithCardSlotChipsProps {
  readonly slot: BookingSlotView;
  /** Draws the slot with the registered sources' chips (empty when none are registered). */
  readonly children: (chips: readonly CardSlotChip[]) => ReactNode;
}

/** The chips every registered source adds to one slot, lowest `order` first. */
export function WithCardSlotChips({ slot, children }: WithCardSlotChipsProps) {
  const sources = sortedByOrder(chipSources.useDefinitions());
  return (
    <ChipChain sources={sources} slot={slot} collected={[]}>
      {children}
    </ChipChain>
  );
}
