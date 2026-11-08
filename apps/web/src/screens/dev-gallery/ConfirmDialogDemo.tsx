import { useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { ConfirmDialogTone } from '@/components/ConfirmDialog';
import { Cluster, Stack } from '@/components/layout';
import styles from './InteractiveDemos.module.css';

/** How long each demo action pretends to work before it settles. */
const DEMO_DELAY_MS = 500;

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

interface ConfirmExample {
  readonly id: string;
  readonly opener: string;
  readonly tone: ConfirmDialogTone;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  /** True for the demo whose action fails, to show the error state. */
  readonly fails: boolean;
}

const CONFIRM_EXAMPLES: readonly ConfirmExample[] = [
  {
    id: 'advance',
    opener: 'Advance a week',
    tone: 'default',
    title: 'Advance to next week?',
    body: 'Seven days run, including two rival shows. Your inbox will stop the skip if anything needs you.',
    confirmLabel: 'Advance',
    fails: false,
  },
  {
    id: 'delete',
    opener: 'Delete save',
    tone: 'danger',
    title: 'Delete this save?',
    body: 'The save slot and its backups are removed from this browser. This cannot be undone.',
    confirmLabel: 'Delete save',
    fails: false,
  },
  {
    id: 'delete-locked',
    opener: 'Delete locked save',
    tone: 'danger',
    title: 'Delete the locked save?',
    body: 'This one fails after half a second, so the dialog stays open and shows the error.',
    confirmLabel: 'Delete anyway',
    fails: true,
  },
];

/** Gallery demo: default and danger confirms, and one whose action fails. */
export function ConfirmDialogDemo() {
  const [openExampleId, setOpenExampleId] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState('Nothing confirmed yet.');

  return (
    <Stack gap={3}>
      <Cluster gap={2}>
        {CONFIRM_EXAMPLES.map((example) => (
          <Button
            key={example.id}
            variant={example.tone === 'danger' ? 'danger' : 'secondary'}
            onClick={() => {
              setOpenExampleId(example.id);
            }}
          >
            {example.opener}
          </Button>
        ))}
      </Cluster>
      <p className={styles['status']} aria-live="polite">
        {lastOutcome}
      </p>
      {CONFIRM_EXAMPLES.map((example) => (
        <ConfirmDialog
          key={example.id}
          open={openExampleId === example.id}
          onClose={() => {
            setOpenExampleId(null);
          }}
          onConfirm={async () => {
            await wait(DEMO_DELAY_MS);
            if (example.fails) {
              throw new Error('The save slot is locked by another tab. Close it and try again.');
            }
            setLastOutcome(`Confirmed: ${example.confirmLabel}.`);
          }}
          tone={example.tone}
          title={example.title}
          body={example.body}
          confirmLabel={example.confirmLabel}
        />
      ))}
    </Stack>
  );
}
