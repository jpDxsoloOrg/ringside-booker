import { useState } from 'react';
import { parseId } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { NO_FREE_AGENT_FILTERS } from '@/screens/contracts/contractsListParams';
import type { FreeAgentFilters } from '@/screens/contracts/contractsListParams';
import { aFreeAgentRow } from '@/screens/contracts/contractFixtures';
import { FreeAgentsFilterBar } from '@/screens/contracts/freeAgents/FreeAgentsFilterBar';
import type { GalleryEntry } from '../galleryEntry';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

/** Two free agents in two countries, so "Based in" and "Country" have something to offer. */
const ROWS = [
  aFreeAgentRow(),
  aFreeAgentRow({
    personId: parseId('person', 'per_0000000903'),
    ringName: 'Kenji Arata',
    gender: 'male',
    basedIn: {
      countryId: parseId('country', 'cty_0000000902'),
      countryName: 'Japan',
      continentId: parseId('continent', 'ctn_0000000902'),
      continentName: 'Asia',
    },
  }),
];

function FilterBarDemo({ layout }: { readonly layout: 'bar' | 'sheet' }) {
  const [filters, setFilters] = useState<FreeAgentFilters>({
    ...NO_FREE_AGENT_FILTERS,
    gender: 'female',
    push: 'midCard',
  });
  const [situation, setSituation] = useState<'freeAgent' | 'all'>('all');
  return (
    <FreeAgentsFilterBar
      filters={filters}
      rows={ROWS}
      situation={situation}
      onChange={setFilters}
      onSituationChange={setSituation}
      layout={layout}
    />
  );
}

function ContractsFiltersDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Desktop: the filters wrap above the table</h3>
        <FilterBarDemo layout="bar" />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Phone: one column, inside the Filters sheet</h3>
        <div className={broadcast['phoneColumn']}>
          <FilterBarDemo layout="sheet" />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'contracts-filters',
  title: 'Free agents filters',
  group: 'Office',
  notes:
    'Contracts › Free agents (ECO5-09), built from the Workers list’s controls: situation, role, gender, push expectation, style, age range, popularity in your regions and where they are based, with Clear filters.',
  render: () => <ContractsFiltersDemo />,
};
