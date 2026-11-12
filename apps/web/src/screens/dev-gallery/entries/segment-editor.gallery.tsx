import { Button } from '@/components/Button';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Cluster, Stack } from '@/components/layout';
import { SegmentEditorSheet } from '@/screens/booking/editor/SegmentEditorSheet';
import { useSegmentEditor } from '@/screens/booking/editor/editorStore';
import type { GalleryEntry } from '../galleryEntry';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import {
  GALLERY_CATALOG,
  GALLERY_EDITOR_CARD,
  GALLERY_PROMO,
  GALLERY_SINGLES,
  GALLERY_TAG,
  galleryAvailableWorkers,
  gallerySlotRoles,
} from '../fixtures/segmentEditor';
import styles from './entries.module.css';

/** Answers quickly, so the sheet fills in as soon as it opens. */
const ANSWER_DELAY_MS = 50;

function createEditorTransport(): EngineTransport {
  return createTraceFixtureTransport([], ANSWER_DELAY_MS, {
    'match.catalog': () => GALLERY_CATALOG,
    'match.slotRoles': gallerySlotRoles,
    'booking.availableWorkers': (args) => galleryAvailableWorkers(args.kind, args.search),
  });
}

function SegmentEditorDemo() {
  const openNew = useSegmentEditor((state) => state.openNew);
  const openExisting = useSegmentEditor((state) => state.openExisting);
  const eventInstanceId = GALLERY_EDITOR_CARD.show.eventInstanceId;
  return (
    <EngineProvider createTransport={createEditorTransport}>
      <Stack gap={4}>
        <p className={styles['caption']}>
          The card here is static and the stand-in engine refuses every command, so Save shows a
          refusal the way a real one looks.
        </p>
        <Cluster gap={2}>
          <Button
            onClick={() => {
              openExisting(GALLERY_SINGLES.segmentId);
            }}
          >
            Singles with a result
          </Button>
          <Button
            onClick={() => {
              openExisting(GALLERY_TAG.segmentId);
            }}
          >
            Tag match with a title
          </Button>
          <Button
            onClick={() => {
              openExisting(GALLERY_PROMO.segmentId);
            }}
          >
            Talking segment
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              openNew({ eventInstanceId, preShow: false, slot: 0, kind: 'match' });
            }}
          >
            New match in the opener
          </Button>
        </Cluster>
        <SegmentEditorSheet card={GALLERY_EDITOR_CARD} />
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'segment-editor',
  title: 'Segment editor',
  group: 'Overlays',
  notes:
    'The booking screen’s segment editor (EVT2-06) on a static card: kind (new only), type with its limits and Long/Short chip, sides with the roster picker, titles (another brand, missing champion), the planned result and method, the billing line. A full-height sheet on a phone.',
  render: () => <SegmentEditorDemo />,
};
