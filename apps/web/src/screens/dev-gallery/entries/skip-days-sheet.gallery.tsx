import { useEffect, useState } from 'react';
import { addDays, parseGameDate } from '@ringside/engine';
import { registerSkipTarget } from '@/app/AppShell/day/skipTargets';
import { SkipDaysSheet } from '@/app/AppShell/day/SkipDaysSheet';
import type { AdvanceRequest } from '@/worker/engineHost';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { formatGameDate } from '@/components/format';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import type { GalleryEntry } from '../galleryEntry';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';

const TODAY = parseGameDate('2031-01-31');
const TOUR_END = addDays(TODAY, 23);

function describeRequest(request: AdvanceRequest): string {
  const stop =
    request.stopAtDate === undefined
      ? ''
      : `, stopping on ${formatGameDate(request.stopAtDate, 'long')}`;
  return `Would skip up to ${String(request.maxDays)} days${stop}.`;
}

/**
 * The Skip days sheet with its built-in quick choices and, while this entry is open, one long
 * custom target registered the way another feature would. It is removed again when the entry
 * closes, so it never reaches a real game's sheet.
 */
function SkipDaysSheetDemo() {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState<AdvanceRequest | null>(null);
  useEffect(
    () =>
      registerSkipTarget({
        id: 'gallery.tourEnd',
        label: 'Until the end of the Harbor Lights summer tour',
        order: 45,
        useResolve: () => ({
          request: { maxDays: 23, stopAtDate: TOUR_END },
          detail: `${formatGameDate(TOUR_END, 'dayMonthYear')} · 23 days`,
        }),
      }),
    [],
  );
  return (
    <Stack gap={3}>
      <Cluster gap={2}>
        <Button
          variant="secondary"
          iconStart="fast-forward"
          onClick={() => {
            setOpen(true);
          }}
        >
          Skip days
        </Button>
      </Cluster>
      <p>{started === null ? 'Nothing started yet.' : describeRequest(started)}</p>
      <SkipDaysSheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        today={TODAY}
        onStart={setStarted}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'skip-days-sheet',
  title: 'Skip days sheet',
  group: 'Overlays',
  notes:
    'The quick choices come from the skip-target registry: 7, 30 and 90 days, until the 1st of ' +
    'next month, and here a long custom target to show the chips wrapping. Each chip names its ' +
    'end under the label. Alert settings needs a game, so it opens only in play.',
  // Features' targets may read the engine (EVT1's "Until next show"); the gallery has no game, so
  // they get a stand-in that answers nothing and their chips stay hidden.
  render: () => (
    <EngineProvider createTransport={createNoGameTransport}>
      <SkipDaysSheetDemo />
    </EngineProvider>
  ),
};

function createNoGameTransport(): EngineTransport {
  return createTraceFixtureTransport([]);
}
