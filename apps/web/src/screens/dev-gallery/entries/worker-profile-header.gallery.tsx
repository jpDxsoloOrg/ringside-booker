import type { WorkerProfileHeader as WorkerProfileHeaderData } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { WorkerProfileHeader } from '@/screens/workers/profile/WorkerProfileHeader';
import type { GalleryEntry } from '../galleryEntry';
import {
  galleryFreeAgentHeader,
  galleryLongNameHeader,
  galleryOwnHeader,
} from '../fixtures/workerProfiles';
import styles from './entries.module.css';

interface HeaderExample {
  readonly caption: string;
  readonly header: WorkerProfileHeaderData;
}

const EXAMPLES: readonly HeaderExample[] = [
  { caption: 'One of your own: every fact, a push and an alignment', header: galleryOwnHeader },
  {
    caption: 'A long ring name and employer wrap; the legal name shows when it differs',
    header: galleryLongNameHeader,
  },
  {
    caption: 'A free agent who has not debuted: no push, no alignment chip',
    header: galleryFreeAgentHeader,
  },
];

function WorkerProfileHeaderDemo() {
  return (
    <Stack gap={5}>
      {EXAMPLES.map((example) => (
        <section key={example.header.personId} className={styles['example']}>
          <p className={styles['caption']}>{example.caption}</p>
          <WorkerProfileHeader header={example.header} heading="section" />
        </section>
      ))}
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'worker-profile-header',
  title: 'Worker profile header',
  group: 'Office',
  notes:
    'The top of a worker profile: picture, ring name, chips, then the facts in a row (two columns on a phone). Weight class has a Why? with the four limits. On the profile the name is the page heading; here it is a section heading.',
  render: () => <WorkerProfileHeaderDemo />,
};
