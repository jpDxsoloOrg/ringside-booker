import { Stack } from '@/components/layout';
import { RivalResultLine } from '@/screens/promotions/profile/shows/RivalResultLine';
import type { GalleryEntry } from '../galleryEntry';
import {
  galleryDrawResult,
  galleryLongNamesResult,
  galleryNewChampionResult,
  galleryResultTraceOf,
  galleryRetainedResult,
  gallerySummarisedResult,
  galleryWinResult,
} from '../fixtures/rivalResults';
import type { GalleryResult } from '../fixtures/rivalResults';
import styles from './entries.module.css';

const EXAMPLES: readonly { readonly title: string; readonly result: GalleryResult }[] = [
  { title: 'A win with its method, finish and reason', result: galleryWinResult },
  { title: 'A draw', result: galleryDrawResult },
  { title: 'A title retained', result: galleryRetainedResult },
  { title: 'A new champion', result: galleryNewChampionResult },
  { title: 'Full reasons no longer kept (no Why?)', result: gallerySummarisedResult },
  { title: 'Long names, three titles on the line', result: galleryLongNamesResult },
];

function RivalResultLineDemo() {
  return (
    <Stack gap={5}>
      {EXAMPLES.map((example) => (
        <section key={example.title} className={styles['example']}>
          <h3 className={styles['subheading']}>{example.title}</h3>
          <RivalResultLine
            view={example.result.view}
            sides={example.result.sides}
            matchLabel={example.result.matchLabel}
            traceOf={galleryResultTraceOf}
          />
        </section>
      ))}
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Compact, as the results page lists it</h3>
        <RivalResultLine
          view={galleryNewChampionResult.view}
          sides={galleryNewChampionResult.sides}
          matchLabel={galleryNewChampionResult.matchLabel}
          traceOf={galleryResultTraceOf}
          compact
        />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'rival-result-line',
  title: 'Rival result line',
  group: 'Broadcast',
  notes:
    'How a rival booker’s match turned out: "<winners> def. <losers> · Method · Finish · reason" with a Why? for the call, then a Retained or New champion badge per title with its own Why?. A draw says Draw; a reason whose breakdown is no longer kept is plain text with no Why?. On a phone the method and reason wrap onto their own line and each badge keeps its Why? beside it.',
  render: () => <RivalResultLineDemo />,
};
