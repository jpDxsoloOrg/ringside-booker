import { RecentForm } from '@/components/RecentForm';
import type { RecentFormItem } from '@/components/RecentForm';
import { Stack } from '@/components/layout';
import {
  mixedForm,
  unknownChangesForm,
  winStreakForm,
} from '@/components/RecentForm/recentFormFixtures';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

/**
 * The gallery has no engine to fetch a breakdown from, so the stand-in references are dropped:
 * in the game a Why? sits beside every change whose breakdown is still kept.
 */
function withoutRefs(items: readonly RecentFormItem[]): RecentFormItem[] {
  return items.map((item) => ({ ...item, traceRefs: { popularity: null, momentum: null } }));
}

function Example({ title, items }: { readonly title: string; readonly items: RecentFormItem[] }) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <Stack gap={3}>
        <RecentForm items={items} variant="strip" />
        <RecentForm items={items} variant="list" />
      </Stack>
    </section>
  );
}

function RecentFormDemo() {
  return (
    <Stack gap={5}>
      <Example title="A five-win streak" items={withoutRefs(winStreakForm())} />
      <Example title="Win, loss, draw, no contest" items={withoutRefs(mixedForm())} />
      <Example title="Changes no longer known" items={withoutRefs(unknownChangesForm())} />
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Ten pills</h3>
        <RecentForm items={[...mixedForm(), ...winStreakForm()]} variant="strip" />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>No matches</h3>
        <RecentForm items={[]} variant="list" />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'recent-form',
  title: 'RecentForm',
  group: 'Data',
  notes:
    'A worker\'s last matches (MTCH3-04): the strip of W / L / D / NC pills, newest first, each named in full for screen readers ("Win against Kara Voss, Altura Mainstage, Jan 30, 2027"), and the list with the popularity and momentum changes. "—" is a change no longer known. In the game a Why? sits beside each change while its breakdown is kept; the gallery has no engine to fetch one from, so none show here.',
  render: () => <RecentFormDemo />,
};
