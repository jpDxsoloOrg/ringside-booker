import { Button, IconButton } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { Tooltip } from '@/components/Tooltip';
import type { TooltipSide } from '@/components/Tooltip';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const TOOLTIP_SIDES: readonly TooltipSide[] = ['top', 'right', 'bottom', 'left'];

function TooltipDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Sides</h3>
        <Cluster gap={2}>
          {TOOLTIP_SIDES.map((side) => (
            <Tooltip key={side} side={side} content={`Shown on the ${side}`}>
              <Button size="sm">{`Hint ${side}`}</Button>
            </Tooltip>
          ))}
        </Cluster>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>On icon buttons and longer hints</h3>
        <Cluster gap={2}>
          <Tooltip content="Advance one day">
            <IconButton icon="fast-forward" label="Next day" />
          </Tooltip>
          <Tooltip content="Popularity is judged per region, then rolled up by population.">
            <Button size="sm" variant="ghost" iconStart="help">
              Why popularity?
            </Button>
          </Tooltip>
        </Cluster>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'tooltip',
  title: 'Tooltip',
  group: 'Overlays',
  notes:
    'Hover for a moment, or Tab to a button to show it at once; Escape hides it. Touch screens have no hover, so a tooltip never holds the only copy of anything.',
  render: () => <TooltipDemo />,
};
