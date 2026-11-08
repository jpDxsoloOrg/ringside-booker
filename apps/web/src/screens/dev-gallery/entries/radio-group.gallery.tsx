import { useState } from 'react';
import { formatMoney } from '@/components/format';
import type { MoneyStyle } from '@/components/format';
import { Stack } from '@/components/layout';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { cents } from '@ringside/engine';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

type MotionChoice = 'system' | 'on' | 'off';

const EXAMPLE_AMOUNT = cents(123_456_700);

const MOTION_OPTIONS: readonly RadioOption<MotionChoice>[] = [
  { value: 'system', label: 'Match device', description: 'Follow this device.' },
  { value: 'on', label: 'Reduce motion', description: 'No pulses or crawls.' },
  { value: 'off', label: 'Full motion', description: 'Keep every animation.' },
];

const MONEY_OPTIONS: readonly RadioOption<MoneyStyle>[] = [
  {
    value: 'compact',
    label: 'Compact',
    description: formatMoney(EXAMPLE_AMOUNT, { style: 'compact' }),
  },
  { value: 'full', label: 'Full', description: formatMoney(EXAMPLE_AMOUNT, { style: 'full' }) },
];

function RadioGroupDemo() {
  const [motion, setMotion] = useState<MotionChoice>('system');
  const [money, setMoney] = useState<MoneyStyle>('compact');

  return (
    <Stack gap={6}>
      <RadioGroup
        legend="Animations"
        options={MOTION_OPTIONS}
        value={motion}
        onValueChange={setMotion}
      />
      <RadioGroup
        legend="Money"
        description="Row layout: side by side while there is room."
        options={MONEY_OPTIONS}
        value={money}
        layout="row"
        onValueChange={setMoney}
      />
      <p className={styles['caption']}>{`Picked: ${motion}, ${money}.`}</p>
      <RadioGroup
        legend="Season length"
        description="Disabled: set when the game starts."
        options={[
          { value: 'quarter', label: '3 months' },
          { value: 'year', label: '12 months' },
        ]}
        value="year"
        onValueChange={() => undefined}
        disabled
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'radio-group',
  title: 'RadioGroup',
  group: 'Primitives',
  notes:
    'One choice from a short list that applies straight away. Tab reaches the group, the arrow keys move and pick, and every option is at least 44px tall.',
  render: () => <RadioGroupDemo />,
};
