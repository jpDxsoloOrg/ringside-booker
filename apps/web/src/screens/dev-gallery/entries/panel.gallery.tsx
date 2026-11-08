import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import { Panel } from '@/components/Panel';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function PanelDemo() {
  return (
    <Stack gap={4}>
      <Panel
        title="Plain panel"
        subtitle="With a subtitle and an action"
        headingLevel={3}
        actions={
          <Button size="sm" iconStart="settings">
            Edit
          </Button>
        }
      >
        <p>Body content sits on the surface with medium padding.</p>
      </Panel>
      <Panel title="Collapsible panel" subtitle="Open to start" headingLevel={3} collapsible>
        <p>Enter or Space on the title shows and hides this.</p>
      </Panel>
      <Panel title="Starts collapsed" headingLevel={3} collapsible defaultCollapsed>
        <p>Hidden until opened.</p>
      </Panel>
      <Panel title="No padding" as="div" headingLevel={3} padding="none">
        <div className={styles['demoBox']}>Content runs to the panel edge.</div>
      </Panel>
      <Panel
        variant="broadcast"
        title="Broadcast panel"
        subtitle="Square, chamfered corners for show moments"
        headingLevel={3}
        actions={
          <Button size="sm" variant="primary" iconStart="play">
            Go live
          </Button>
        }
      >
        <p>The header sits behind a skewed red-orange slash, like a sports graphic.</p>
      </Panel>
      <Panel
        variant="broadcast"
        title="Collapsible broadcast"
        headingLevel={3}
        collapsible
        defaultCollapsed
      >
        <p>Results headers can fold away too.</p>
      </Panel>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'panel',
  title: 'Panel',
  group: 'Primitives',
  notes:
    'Office cards (rounded, hairline) for management screens and broadcast panels (square, chamfered) for show moments. On phones panels run edge to edge.',
  render: () => <PanelDemo />,
};
