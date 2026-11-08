import { useId, useState } from 'react';
import { useOptionalEngineClient } from '@/app/engine/EngineProvider';
import type { EngineClient } from '@/app/engine/engineClient';
import { devRoutesEnabled } from '@/app/dev/EnterShellRoute';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

type PingState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'answered'; readonly engineVersion: string; readonly roundTripMs: number }
  | { readonly kind: 'failed'; readonly message: string };

function EngineWorkerControls({ client }: { readonly client: EngineClient }) {
  const [ping, setPing] = useState<PingState>({ kind: 'idle' });
  const pingHeadingId = useId();
  const crashHeadingId = useId();

  const pingEngine = async (): Promise<void> => {
    setPing({ kind: 'pending' });
    const startedAt = performance.now();
    try {
      const { engineVersion } = await client.ping();
      setPing({
        kind: 'answered',
        engineVersion,
        roundTripMs: Math.round(performance.now() - startedAt),
      });
    } catch (error: unknown) {
      setPing({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <Stack gap={6}>
      <section aria-labelledby={pingHeadingId} className={styles['example']}>
        <h3 id={pingHeadingId} className={styles['subheading']}>
          Engine ping
        </h3>
        <Cluster gap={3}>
          <Button
            size="sm"
            iconStart="play"
            loading={ping.kind === 'pending'}
            onClick={() => {
              void pingEngine();
            }}
          >
            Ping engine
          </Button>
          {ping.kind === 'answered' && <Badge tone="positive">Worker answered</Badge>}
          {ping.kind === 'failed' && <Badge tone="negative">No answer</Badge>}
        </Cluster>
        <dl className={styles['formatList']} aria-live="polite">
          <div className={styles['formatRow']}>
            <dt>Engine version</dt>
            <dd>{ping.kind === 'answered' ? ping.engineVersion : '–'}</dd>
          </div>
          <div className={styles['formatRow']}>
            <dt>Round trip</dt>
            <dd>{ping.kind === 'answered' ? `${String(ping.roundTripMs)} ms` : '–'}</dd>
          </div>
          {ping.kind === 'failed' && (
            <div className={styles['formatRow']}>
              <dt>Error</dt>
              <dd>{ping.message}</dd>
            </div>
          )}
        </dl>
      </section>
      <section aria-labelledby={crashHeadingId} className={styles['example']}>
        <h3 id={crashHeadingId} className={styles['subheading']}>
          Crash engine
        </h3>
        <p className={styles['caption']}>
          Makes the worker throw an uncaught error. The whole app should switch to the
          &ldquo;simulation stopped&rdquo; screen; reload to get back.
        </p>
        <Cluster gap={3}>
          <Button
            size="sm"
            variant="danger"
            iconStart="warning"
            onClick={() => {
              client.crashForTesting();
            }}
          >
            Crash engine
          </Button>
        </Cluster>
      </section>
    </Stack>
  );
}

function EngineWorkerSample() {
  const client = useOptionalEngineClient();
  if (!devRoutesEnabled({ DEV: import.meta.env.DEV, VITE_E2E: import.meta.env.VITE_E2E })) {
    return <p className={styles['caption']}>Only in dev and test builds.</p>;
  }
  if (client === null) {
    return <p className={styles['caption']}>No engine on this page.</p>;
  }
  return <EngineWorkerControls client={client} />;
}

export const galleryEntry: GalleryEntry = {
  id: 'engine-worker',
  title: 'Engine worker',
  group: 'Engine',
  notes:
    'Dev and test builds only. Pings the engine through its Web Worker and shows the version it ' +
    'reports, and can crash the worker to show the "simulation stopped" screen.',
  render: () => <EngineWorkerSample />,
};
