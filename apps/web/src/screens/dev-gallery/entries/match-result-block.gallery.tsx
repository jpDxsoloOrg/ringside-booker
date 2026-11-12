import type { SimulateResult } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { MatchResultBlock } from '@/screens/match-lab/result/MatchResultBlock';
import {
  disqualificationSimulation,
  drawSimulation,
  noContestSimulation,
  randomWinnersSimulation,
  winSimulation,
} from '@/screens/match-lab/result/simulationFixtures';
import type { GalleryEntry } from '../galleryEntry';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

const LONG_NAMES = [
  'Bartholomew "The Lighthouse" Vandermeer-Ashcombe',
  'Seraphina Okonkwo-Lindqvist',
  'Maximilian Thornbury the Third',
];

interface ExampleProps {
  readonly title: string;
  readonly simulation: SimulateResult;
  readonly titlesOnLine?: boolean;
  readonly narrow?: boolean;
}

function Example({ title, simulation, titlesOnLine = false, narrow = false }: ExampleProps) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={broadcast['stage']}>
        <div className={narrow ? broadcast['phoneColumn'] : undefined}>
          <MatchResultBlock
            simulation={simulation}
            ratedOn={null}
            today={null}
            outOfDate={false}
            titlesOnLine={titlesOnLine}
          />
        </div>
      </div>
    </section>
  );
}

function MatchResultBlockDemo() {
  return (
    <Stack gap={5}>
      <Example title="A win" simulation={winSimulation()} />
      <Example title="A draw" simulation={drawSimulation()} />
      <Example title="No contest" simulation={noContestSimulation()} />
      <Example title="Random winners" simulation={randomWinnersSimulation()} />
      <Example title="Long names at 390px" simulation={winSimulation(LONG_NAMES)} narrow />
      <Example
        title="A title on the line, no title change"
        simulation={disqualificationSimulation()}
        titlesOnLine
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'match-result-block',
  title: 'MatchResultBlock',
  group: 'Broadcast',
  notes:
    "The Match lab's simulated result (MTCH2-04): the headline with a Why? on the winner, the method and finish with a category badge, then the lab's score bug, crowd line and slot. Hand-made answers; the Why? panels show small stand-in traces. The title note only shows once MTCH8 puts titles on the line.",
  render: () => <MatchResultBlockDemo />,
};
