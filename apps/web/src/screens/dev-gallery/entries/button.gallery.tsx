import { useState } from 'react';
import { Button, IconButton } from '@/components/Button';
import type { ButtonVariant } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const BUTTON_VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];

function ButtonDemo() {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <Stack gap={5}>
      {BUTTON_VARIANTS.map((variant) => (
        <section key={variant} className={styles['example']}>
          <h3 className={styles['subheading']}>{variant}</h3>
          <Cluster gap={2}>
            <Button variant={variant}>Book show</Button>
            <Button variant={variant} size="sm">
              Small
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
  notes: 'Every variant at both sizes, with icons, disabled and loading. IconButton below.',
  render: () => <ButtonDemo />,
};
