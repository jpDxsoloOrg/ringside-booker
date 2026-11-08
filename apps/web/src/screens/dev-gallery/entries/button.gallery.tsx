import { useState } from 'react';
import { Button, BUTTON_SIZES, BUTTON_VARIANTS, IconButton } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const VARIANT_NOTES = {
  primary: 'Action fill, white text: the one main action in an area.',
  secondary: 'Cyan outline: the default for everything else.',
  prestige: 'Gold fill, dark text: title and award moments.',
  ghost: 'No chrome: toolbars and row actions.',
  danger: 'Rose fill, dark text: release, delete, give up.',
} as const;

function ButtonDemo() {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <Stack gap={5}>
      {BUTTON_VARIANTS.map((variant) => (
        <section key={variant} className={styles['example']}>
          <h3 className={styles['subheading']}>{variant}</h3>
          <p className={styles['caption']}>{VARIANT_NOTES[variant]}</p>
          <Cluster gap={2}>
            <Button variant={variant}>Book show</Button>
            <Button variant={variant} size="sm">
              Small
            </Button>
            <Button variant={variant} size="lg">
              Large
            </Button>
            <Button variant={variant} iconStart="play">
              Run show
            </Button>
            <Button variant={variant} iconEnd="chevron-right">
              Next day
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} loading>
              Loading
            </Button>
          </Cluster>
        </section>
      ))}
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Sizes</h3>
        <p className={styles['caption']}>
          On touch screens and at phone width every size is at least 44px tall.
        </p>
        <Cluster gap={2}>
          {BUTTON_SIZES.map((size) => (
            <Button key={size} variant="primary" size={size} iconStart="play">
              Go live ({size})
            </Button>
          ))}
        </Cluster>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Icon buttons</h3>
        <Cluster gap={2}>
          {BUTTON_VARIANTS.map((variant) => (
            <IconButton
              key={variant}
              icon="settings"
              label={`Settings (${variant})`}
              variant={variant}
            />
          ))}
          <IconButton icon="close" label="Close (small)" size="sm" />
          <IconButton icon="trophy" label="Award (large)" variant="prestige" size="lg" />
          <IconButton icon="trash" label="Delete" variant="danger" size="sm" />
        </Cluster>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Loading keeps its width</h3>
        <Cluster gap={2}>
          <Button variant="primary" loading={isSaving} iconStart="download">
            Save game
          </Button>
          <Button
            aria-pressed={isSaving}
            onClick={() => {
              setIsSaving((wasSaving) => !wasSaving);
            }}
          >
            Toggle loading
          </Button>
        </Cluster>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'button',
  title: 'Button',
  group: 'Primitives',
  notes:
    'Every variant at every size, with icons, disabled and loading. Tab through to see the cyan focus ring. IconButton below.',
  render: () => <ButtonDemo />,
};
