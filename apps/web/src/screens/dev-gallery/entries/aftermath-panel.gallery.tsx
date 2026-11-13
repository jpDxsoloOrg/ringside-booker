import { useState } from 'react';
import type { SegmentAftermath } from '@ringside/engine';
import { Stack } from '@/components/layout';
import {
  FIXTURE_PROMOTION_NAME,
  fourWayAftermath,
  singlesUpsetAftermath,
} from '@/screens/match-lab/aftermath/aftermathFixtures';
import type { AftermathLevel } from '@/screens/match-lab/aftermath/aftermathText';
import { AftermathView } from '@/screens/match-lab/aftermath/AftermathView';
import type { GalleryEntry } from '../galleryEntry';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

interface ExampleProps {
  readonly title: string;
  readonly aftermath: SegmentAftermath;
  readonly stale?: boolean;
  readonly narrow?: boolean;
}

function Example({ title, aftermath, stale = false, narrow = false }: ExampleProps) {
  const [level, setLevel] = useState<AftermathLevel>('region');
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={narrow ? broadcast['phoneColumn'] : undefined}>
        <AftermathView
          aftermath={aftermath}
          promotionName={FIXTURE_PROMOTION_NAME}
          level={level}
          onLevelChange={setLevel}
          stale={stale}
        />
      </div>
    </section>
  );
}

function AftermathPanelDemo() {
  return (
    <Stack gap={5}>
      <Example
        title="A singles upset, with neighbours and a TV reach region"
        aftermath={singlesUpsetAftermath()}
      />
      <Example title="A four-way, one worker with no contract" aftermath={fourWayAftermath()} />
      <Example title="Setup changed after the Run" aftermath={singlesUpsetAftermath()} stale />
      <Example title="At 390px" aftermath={fourWayAftermath()} narrow />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'aftermath-panel',
  title: 'AftermathPanel',
  group: 'Engine',
  notes:
    "The Match lab's Aftermath panel (MTCH3-04): popularity in the show's region before and after, the neighbours behind a toggle, reach rows, the Region / Country / Continent roll-ups and momentum, each change with a Why?. Hand-made answers with small stand-in traces. No morale: a result never changes it.",
  render: () => <AftermathPanelDemo />,
};
