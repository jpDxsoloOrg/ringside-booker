import { useState } from 'react';
import { Stack } from '@/components/layout';
import { MoneyField } from '@/components/MoneyField';
import type { GalleryEntry } from '../galleryEntry';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

function Example({
  title,
  narrow = false,
  children,
}: {
  readonly title: string;
  readonly narrow?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={narrow ? broadcast['phoneColumn'] : undefined}>{children}</div>
    </section>
  );
}

function MoneyFieldDemo() {
  const [empty, setEmpty] = useState(0);
  const [filled, setFilled] = useState(4_130_000);
  const [phone, setPhone] = useState(2_400_000);
  return (
    <Stack gap={5}>
      <Example title="Empty">
        <MoneyField label="Signing bonus" value={empty} onValueChange={setEmpty} />
      </Example>
      <Example title="Filled, with what they ask">
        <MoneyField
          label="Monthly wage"
          value={filled}
          onValueChange={setFilled}
          hint="They ask $41,300"
        />
      </Example>
      <Example title="With an error">
        <MoneyField
          label="Fee per appearance"
          value={0}
          onValueChange={() => undefined}
          error="A per-appearance deal needs a fee"
        />
      </Example>
      <Example title="Phone width (390px)" narrow>
        <MoneyField
          label="Monthly wage"
          value={phone}
          onValueChange={setPhone}
          hint="They ask $34,300"
        />
      </Example>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'money-field',
  title: 'MoneyField',
  group: 'Primitives',
  notes:
    'A money input in whole units (ECO5-06): shows "$41,300", opens the number keypad on a phone, hands back cents, and keeps what you type until you leave the field. A hint says what they ask; an error sits under it with an icon. 44px tall and 16px text on touch screens.',
  render: () => <MoneyFieldDemo />,
};
