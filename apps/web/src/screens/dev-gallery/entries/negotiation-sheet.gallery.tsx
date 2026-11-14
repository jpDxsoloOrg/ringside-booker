import { useState } from 'react';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import {
  NegotiationSheetView,
  type NegotiationSheetViewProps,
} from '@/screens/contracts/negotiation/NegotiationSheetView';
import {
  aHistory,
  anAsk,
  aPreview,
  aStaticDraft,
  NEGOTIATION_ID,
  NEGOTIATION_PERSON,
} from '@/screens/contracts/negotiation/negotiationFixtures';
import { useContractMoney } from '@/screens/contracts/useContractMoney';
import type { GalleryEntry } from '../galleryEntry';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import styles from './entries.module.css';

type Variant = 'new' | 'countered' | 'signed';

const noop = (): void => undefined;

function createTransport(): EngineTransport {
  return createTraceFixtureTransport([], 300);
}

function variantProps(
  variant: Variant,
): Omit<NegotiationSheetViewProps, 'open' | 'onClose' | 'money'> {
  const base = {
    header: {
      personId: NEGOTIATION_PERSON,
      ringName: 'Rhea Vance',
      imageRef: null,
      roles: ['wrestler'] as const,
      age: 29,
      situation: 'Free agent',
      currentDeal: null,
    },
    renewal: false,
    roles: ['wrestler'] as const,
    maxLengthMonths: 60,
    bidders: ['Crown Pro', 'Lakeshore'],
    notice: null,
    errors: [],
    pending: false,
    actions: { onSubmit: noop, onAccept: noop, onRevise: noop, onEnd: noop, onWithdraw: noop },
  };
  switch (variant) {
    case 'new':
      return {
        ...base,
        phase: 'new',
        statusText: null,
        draft: aStaticDraft(),
        ask: null,
        offerOnTable: null,
        patience: { left: 3, start: 3 },
        history: null,
        outcome: null,
      };
    case 'countered':
      return {
        ...base,
        phase: 'countered',
        statusText: 'Countered: answer by Jan 14, 2027',
        draft: aStaticDraft({ preview: aPreview('likely', 1) }),
        ask: null,
        offerOnTable: null,
        patience: { left: 2, start: 3 },
        history: { negotiationId: NEGOTIATION_ID, entries: aHistory() },
        outcome: null,
      };
    case 'signed':
      return {
        ...base,
        bidders: [],
        phase: 'closed',
        statusText: null,
        draft: null,
        ask: anAsk(),
        offerOnTable: '$34,200 a month, 24 months',
        patience: null,
        history: { negotiationId: NEGOTIATION_ID, entries: aHistory() },
        outcome: { text: 'Signed', trace: null },
      };
  }
}

function NegotiationSheetDemo() {
  const money = useContractMoney();
  const [open, setOpen] = useState<Variant | null>(null);
  return (
    <EngineProvider createTransport={createTransport}>
      <Stack gap={4}>
        <p className={styles['caption']}>
          Static samples. Each opens the sheet as a side panel on desktop and full height on a
          phone, with the footer pinned.
        </p>
        <Button
          onClick={() => {
            setOpen('new');
          }}
        >
          New offer
        </Button>
        <Button
          onClick={() => {
            setOpen('countered');
          }}
        >
          Countered, with the talks so far
        </Button>
        <Button
          onClick={() => {
            setOpen('signed');
          }}
        >
          Closed: signed
        </Button>
        {open !== null && (
          <NegotiationSheetView
            {...variantProps(open)}
            open
            onClose={() => {
              setOpen(null);
            }}
            money={money}
          />
        )}
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'negotiation-sheet',
  title: 'NegotiationSheet',
  group: 'Overlays',
  notes:
    'The Negotiation Sheet (ECO5-06) from static samples: their ask beside your offer, the reaction meter with its Why?, patience, other bidders by name only, the counter history (CounterHistory) and the footer for each phase: Submit offer; Accept counter / Send revised offer / End talks; read-only once signed.',
  render: () => <NegotiationSheetDemo />,
};
