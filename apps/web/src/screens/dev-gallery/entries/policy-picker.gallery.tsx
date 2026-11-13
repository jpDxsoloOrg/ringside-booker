import { useState } from 'react';
import { POLICY_AREA_DESCRIPTIONS } from '@ringside/engine';
import type { PolicyLevel } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { PolicyPicker } from '@/screens/finances/PolicyPicker';
import { galleryMedicalPreview } from '../fixtures/finance';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

/** The picker with its level kept here, as the engine would after `finance.setPolicy`. */
function PolicyPickerDemo() {
  const [current, setCurrent] = useState<PolicyLevel>(galleryMedicalPreview.current);
  const preview = { ...galleryMedicalPreview, current };
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Side by side (desktop)</h3>
        <Panel title="Medical" subtitle="As on the Policies tab" headingLevel={4}>
          <PolicyPicker
            preview={preview}
            description={POLICY_AREA_DESCRIPTIONS.medical}
            onChange={setCurrent}
          />
        </Panel>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Stacked (phone), while a change is on its way</h3>
        <PolicyPicker
          preview={preview}
          description={POLICY_AREA_DESCRIPTIONS.medical}
          onChange={setCurrent}
          layout="column"
          disabled
        />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'policy-picker',
  title: 'Policy picker',
  group: 'Office',
  notes:
    'One staff policy at its four levels: the monthly cost with its Why?, the change from today ' +
    'and the effect lines other features register. Hand-written data, no engine.',
  render: () => <PolicyPickerDemo />,
};
