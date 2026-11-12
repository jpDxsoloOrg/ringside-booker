import { useState } from 'react';
import { IconButton } from '@/components/Button';
import { CardSlot, CardSlotDragHandle } from '@/components/CardSlot';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import { BROADCAST_SIDES } from '../broadcastFixtures';
import styles from './entries.module.css';
import broadcast from './broadcast.module.css';

function CardSlotDemo() {
  const [lastAction, setLastAction] = useState('Nothing added yet.');

  return (
    <Stack gap={4}>
      <p className={styles['caption']} aria-live="polite">
        {lastAction}
      </p>
      <ol className={broadcast['cardList']}>
        <li>
          <CardSlot
            slotRole="pre-show"
            slotNumber={0}
            headingLevel={3}
            emptyTitle="No pre-show bout"
            emptyHint="Streams before the broadcast. Optional."
            onAddMatch={() => {
              setLastAction('Add match on the pre-show.');
            }}
          />
        </li>
        <li>
          <CardSlot
            slotRole="opener"
            slotNumber={1}
            headingLevel={3}
            chips={[
              { id: 'type', kind: 'match-type', label: 'Singles' },
              { id: 'story', kind: 'storyline', label: 'Street protocol grudge' },
            ]}
            sideA={BROADCAST_SIDES.openerFace}
            sideB={BROADCAST_SIDES.openerHeel}
            winner="a"
            winnerLabel="Chosen winner"
            dragHandle={<CardSlotDragHandle label="Move slot 1" />}
            actions={<IconButton icon="more" label="Slot 1 options" size="sm" />}
          />
        </li>
        <li>
          <CardSlot
            slotRole="midcard"
            slotNumber={2}
            headingLevel={3}
            chips={[
              { id: 'type', kind: 'match-type', label: 'Tag team' },
              { id: 'title', kind: 'title', label: 'Tag titles on the line' },
            ]}
            sideA={BROADCAST_SIDES.tagChampions}
            sideB={BROADCAST_SIDES.tagChallengers}
            winner="a"
            winnerLabel="Retain"
            dragHandle={<CardSlotDragHandle label="Move slot 2" />}
          />
        </li>
        <li>
          <CardSlot
            slotRole="midcard"
            slotNumber={3}
            headingLevel={3}
            emptyTitle="Unassigned segment"
            emptyHint="Add a midcard match or a promo to keep the crowd with you."
            dragHandle={<CardSlotDragHandle label="Move slot 3" />}
            onAddMatch={() => {
              setLastAction('Add match on slot 3.');
            }}
            onAddPromo={() => {
              setLastAction('Add promo on slot 3.');
            }}
          />
        </li>
        <li>
          <CardSlot
            slotRole="semi-main"
            slotNumber={4}
            headingLevel={3}
            chips={[
              { id: 'type', kind: 'match-type', label: 'Promo' },
              { id: 'story', kind: 'storyline', label: 'Contender queue' },
            ]}
            sideA={BROADCAST_SIDES.promo}
            dragHandle={<CardSlotDragHandle label="Move slot 4" />}
          />
        </li>
        <li>
          <CardSlot
            slotRole="main-event"
            slotNumber={5}
            headingLevel={3}
            chips={[
              { id: 'type', kind: 'match-type', label: 'World title' },
              { id: 'title', kind: 'title', label: 'Coastal Crown' },
              { id: 'story', kind: 'storyline', label: 'Rivalry heat +14' },
            ]}
            sideA={BROADCAST_SIDES.mainChampion}
            sideB={BROADCAST_SIDES.mainChallenger}
            dragHandle={<CardSlotDragHandle label="Move slot 5" />}
          />
        </li>
        <li>
          <CardSlot
            slotRole="midcard"
            slotNumber={6}
            headingLevel={3}
            chips={[{ id: 'type', kind: 'match-type', label: 'Triple threat' }]}
            sides={[
              BROADCAST_SIDES.openerFace,
              BROADCAST_SIDES.openerHeel,
              BROADCAST_SIDES.mainChallenger,
            ]}
            winnerIndex={2}
            issues={{ errors: 0, warnings: 1 }}
          />
        </li>
        <li>
          <CardSlot
            slotRole="midcard"
            slotNumber={7}
            headingLevel={3}
            chips={[{ id: 'type', kind: 'match-type', label: 'Four-way' }]}
            sides={[
              BROADCAST_SIDES.openerFace,
              BROADCAST_SIDES.openerHeel,
              BROADCAST_SIDES.mainChampion,
              BROADCAST_SIDES.mainChallenger,
            ]}
            issues={{ errors: 2, warnings: 0 }}
          />
        </li>
        <li>
          <CardSlot
            slotRole="opener"
            slotNumber={8}
            headingLevel={3}
            chips={[{ id: 'type', kind: 'match-type', label: 'Singles' }]}
            sideA={BROADCAST_SIDES.openerFace}
            sideB={BROADCAST_SIDES.openerHeel}
            resultLabel="Draw"
          />
        </li>
        <li>
          <CardSlot
            slotRole="midcard"
            slotNumber={9}
            headingLevel={3}
            emptyHint="A talking segment label, as the booking screen uses it."
            onAddMatch={() => {
              setLastAction('Add match on slot 9.');
            }}
            onAddPromo={() => {
              setLastAction('Add talking segment on slot 9.');
            }}
            addPromoLabel="Add talking segment"
          />
        </li>
      </ol>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'card-slot',
  title: 'CardSlot',
  group: 'Broadcast',
  notes:
    'A card: empty pre-show, a booked opener with a winner, a tag title match, an empty slot, a promo and the main event, then a triple threat with a warning, a four-way with two problems, a draw and an open slot with "Add talking segment". On a phone the sides stack.',
  render: () => <CardSlotDemo />,
};
