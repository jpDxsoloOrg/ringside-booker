import { parseContentKey, parseId } from '@ringside/engine';
import type { InjuredRow } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import type { InjuryCardInjury } from '@/components/InjuryCard';
import { Stack } from '@/components/layout';
import { InjuriesList } from '@/screens/roster/injuries/InjuriesTab';
import type { GalleryEntry } from '../galleryEntry';
import {
  injuryCardTraces,
  minorInjury,
  severeNewInjury,
  untracedInjury,
} from '../fixtures/injuries';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

function createInjuryTraceTransport(): EngineTransport {
  return createTraceFixtureTransport(injuryCardTraces());
}

function rowOf(injury: InjuryCardInjury, index: number, name: string): InjuredRow {
  const suffix = String(200 + index).padStart(10, '0');
  return {
    ...injury,
    injuryId: parseId('injury', `inj_${suffix}`),
    personId: parseId('person', `per_${suffix}`),
    kindKey: parseContentKey('injury.gallery'),
    segmentId: null,
    name,
    imageRef: null,
    employer: null,
    roles: ['wrestler'],
  };
}

/** Three of your wrestlers out, soonest back first; the torn ACL is new. */
function sampleRows(): InjuredRow[] {
  return [
    rowOf(untracedInjury(), 1, 'Dex Harlan'),
    rowOf(minorInjury(), 2, 'Big Joe Okafor'),
    rowOf(severeNewInjury(), 3, 'Marlo Quint'),
  ];
}

function InjuriesListDemo() {
  const rows = sampleRows();
  return (
    <EngineProvider createTransport={createInjuryTraceTransport}>
      <Stack gap={5}>
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>Three out, one not seen yet</h3>
          <InjuriesList rows={rows} />
        </section>
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>Nobody hurt</h3>
          <InjuriesList rows={[]} />
        </section>
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>Phone width (390px)</h3>
          <div className={broadcast['phoneColumn']}>
            <InjuriesList rows={rows} layout="cards" />
          </div>
        </section>
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'injuries-list',
  title: 'Injuries list',
  group: 'Data',
  notes:
    'Your promotion > Roster > Injuries (WRK6-06): who is out, soonest back first. Each name opens the worker\'s Health tab; "New" marks an injury the player has not seen (opening the tab marks it seen, which clears the day control\'s Roster stop). Days left has a Why? for the time out while its breakdown is kept. On a phone each row is a card: the injury and body part under the name, days left as the stat, the return date in the small print.',
  render: () => <InjuriesListDemo />,
};
