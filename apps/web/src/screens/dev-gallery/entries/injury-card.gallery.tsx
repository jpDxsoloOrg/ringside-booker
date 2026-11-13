import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { InjuryCard } from '@/components/InjuryCard';
import type { InjuryCardInjury } from '@/components/InjuryCard';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import {
  healedInjury,
  injuryCardTraces,
  minorInjury,
  severeNewInjury,
  untracedInjury,
} from '../fixtures/injuries';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';
import office from './office.module.css';

function createInjuryTraceTransport(): EngineTransport {
  return createTraceFixtureTransport(injuryCardTraces());
}

interface ExampleProps {
  readonly title: string;
  readonly injury: InjuryCardInjury;
  readonly workerName?: string;
  readonly narrow?: boolean;
}

function Example({ title, injury, workerName, narrow = false }: ExampleProps) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={office['stage']}>
        <div className={narrow ? broadcast['phoneColumn'] : office['sideColumn']}>
          <InjuryCard
            injury={injury}
            headingLevel={4}
            {...(workerName === undefined ? {} : { workerName })}
          />
        </div>
      </div>
    </section>
  );
}

function InjuryCardDemo() {
  return (
    <EngineProvider createTransport={createInjuryTraceTransport}>
      <Stack gap={5}>
        <Example title="Open, minor, from a match" injury={minorInjury()} />
        <Example
          title="Severe, off-screen, not seen yet"
          injury={severeNewInjury()}
          workerName="Marlo Quint"
        />
        <Example title="Healed (history)" injury={healedInjury()} />
        <Example title="Breakdowns no longer kept (no Why?)" injury={untracedInjury()} />
        <Example title="Phone width (390px)" injury={severeNewInjury()} narrow />
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'injury-card',
  title: 'InjuryCard',
  group: 'Office',
  notes:
    'One injury (WRK6-05): its name with a bandage icon, the body part, a severity badge that always has its word, and "New" while the player has not seen it; then Since, Back on, Time out and Days left, Condition lost, Can work angles and How it happened. A Why? sits beside each number whose breakdown is kept; a stand-in engine answers them with breakdowns from the engine\'s own injury formulas. A healed injury reads as history, with a dashed edge and no days left.',
  render: () => <InjuryCardDemo />,
};
