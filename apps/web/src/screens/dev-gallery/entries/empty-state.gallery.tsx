import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Stack } from '@/components/layout';
import { Panel } from '@/components/Panel';
import type { GalleryEntry } from '../galleryEntry';

function EmptyStateDemo() {
  return (
    <Stack gap={4}>
      <Panel title="Inline" as="div" headingLevel={3} padding="none">
        <EmptyState
          icon="search"
          title="No workers match these filters"
          body="Clear a filter to see more of the roster."
        />
      </Panel>
      <Panel title="Page" as="div" headingLevel={3} padding="none">
        <EmptyState
          size="page"
          icon="calendar"
          title="Nothing booked yet"
          body="Your first show is a blank card. Fill the slots to see the forecast."
          headingLevel={4}
          action={
            <Button variant="primary" iconStart="play">
              Book a show
            </Button>
          }
        />
      </Panel>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'empty-state',
  title: 'EmptyState',
  group: 'Primitives',
  render: () => <EmptyStateDemo />,
};
