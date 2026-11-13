import { Panel } from '@/components/Panel';
import { Stack } from '@/components/layout';
import { RecentTitleChangesList } from '@/screens/promotions/profile/overview/RecentTitleChangesList';
import type { GalleryEntry } from '../galleryEntry';
import { galleryResultTraceOf, galleryTitleChanges } from '../fixtures/rivalResults';

function RecentTitleChangesDemo() {
  return (
    <Stack gap={5}>
      <Panel title="Recent title changes" headingLevel={3}>
        <RecentTitleChangesList
          changes={galleryTitleChanges}
          traceOf={galleryResultTraceOf}
          headingLevel={4}
        />
      </Panel>
      <Panel title="Recent title changes (none yet)" headingLevel={3}>
        <RecentTitleChangesList changes={[]} headingLevel={4} />
      </Panel>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'recent-title-changes',
  title: 'Recent title changes',
  group: 'Office',
  notes:
    'The promotion Overview’s panel: the belt, who won which title, whom they beat and how long that reign lasted, the date and a link to the show, then the rival booker’s reason with its Why? while it is kept. A change on your own show, or a vacant title filled before AIP5, has no reason. Empty: "No title changes yet".',
  render: () => <RecentTitleChangesDemo />,
};
