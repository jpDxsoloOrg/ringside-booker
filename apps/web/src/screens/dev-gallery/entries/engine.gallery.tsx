import { ENGINE_VERSION, intBetween, RngRegistry } from '@ringside/engine';
import { useId, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

declare module '@ringside/engine' {
  interface StreamNames {
    'gallery.dice': true;
  }
}

const DICE_COUNT = 20;
const DEFAULT_SEED = 'ringside-1';

/** Twenty d6 rolls from the seed's `gallery.dice` stream, using the engine's own helpers. */
export function rollDice(seed: string): readonly number[] {
  const stream = new RngRegistry(seed).stream('gallery.dice');
  return Array.from({ length: DICE_COUNT }, () => intBetween(stream, 1, 6));
}

/** `ringside-1` → `ringside-2`; anything without a trailing number gets `-2`. */
export function nextSeed(seed: string): string {
  const match = /^(.*?)(\d+)$/.exec(seed);
  if (match === null) return `${seed}-2`;
  return `${match[1] ?? ''}${String(Number(match[2]) + 1)}`;
}

function EngineSample() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const seedInputId = useId();
  const rolls = rollDice(seed);
  const replay = rollDice(seed);
  const replaysExactly = rolls.every((roll, index) => roll === replay[index]);
  const total = rolls.reduce((sum, roll) => sum + roll, 0);

  return (
    <Stack gap={5}>
      <dl className={styles['formatList']}>
        <div className={styles['formatRow']}>
          <dt>ENGINE_VERSION</dt>
          <dd>{ENGINE_VERSION}</dd>
        </div>
        <div className={styles['formatRow']}>
          <dt>App version</dt>
          <dd>{__APP_VERSION__}</dd>
        </div>
      </dl>
      <div className={styles['seedField']}>
        <label htmlFor={seedInputId} className={styles['subheading']}>
          Seed
        </label>
        <input
          id={seedInputId}
          className={styles['seedInput']}
          value={seed}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setSeed(event.target.value);
          }}
        />
      </div>
      <Cluster gap={3}>
        <Button
          size="sm"
          iconStart="fast-forward"
          onClick={() => {
            setSeed(nextSeed);
          }}
        >
          Next seed
        </Button>
        <Badge tone={replaysExactly ? 'positive' : 'negative'}>
          {replaysExactly ? 'Same seed, same rolls' : 'Replay differs'}
        </Badge>
      </Cluster>
      <section className={styles['example']} aria-live="polite">
        <h3 className={styles['subheading']}>
          {DICE_COUNT} d6 rolls, total {total}
        </h3>
        <ol className={styles['diceRow']}>
          {rolls.map((roll, index) => (
            <li key={index} className={styles['die']}>
              {roll}
            </li>
          ))}
        </ol>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'engine',
  title: 'Engine in the browser',
  group: 'Engine',
  notes:
    'The engine package running on the page: its version, and twenty dice from a seeded stream ' +
    'via intBetween(stream, 1, 6). Each roll is drawn twice to show a seed always replays.',
  render: () => <EngineSample />,
};
