import { useId } from 'react';
import { Stack } from '@/components/layout';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import type { TabsActivation } from '@/components/Tabs';
import styles from './InteractiveDemos.module.css';

/** Eight tabs: more than a 390px phone strip can show, so the strip has to scroll. */
const DEMO_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'roster', label: 'Roster' },
  { value: 'titles', label: 'Titles' },
  { value: 'storylines', label: 'Storylines' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'finances', label: 'Finances' },
  { value: 'contracts', label: 'Contracts' },
  { value: 'history', label: 'History' },
] as const;

interface TabsExampleProps {
  readonly activation: TabsActivation;
  readonly heading: string;
  readonly description: string;
}

function TabsExample({ activation, heading, description }: TabsExampleProps) {
  const headingId = useId();
  return (
    <div className={styles['example']} data-tabs-demo={activation}>
      <h3 id={headingId} className={styles['subheading']}>
        {heading}
      </h3>
      <p className={styles['caption']}>{description}</p>
      <Tabs defaultValue="overview" activation={activation}>
        <TabList labelledBy={headingId}>
          {DEMO_TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value}>
              {tab.label}
            </Tab>
          ))}
        </TabList>
        {DEMO_TABS.map((tab) => (
          <TabPanel key={tab.value} value={tab.value}>
            <p className={styles['panelText']}>
              The {tab.label.toLowerCase()} panel. Only the selected panel renders its content.
            </p>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}

/** Gallery demo: the same eight tabs with automatic and with manual activation. */
export function TabsDemo() {
  return (
    <Stack gap={6}>
      <TabsExample
        activation="auto"
        heading="Automatic activation"
        description="Left and Right move between tabs and select them; Home and End jump to the ends."
      />
      <TabsExample
        activation="manual"
        heading="Manual activation"
        description="The arrow keys only move focus. Enter or Space selects the focused tab."
      />
    </Stack>
  );
}
