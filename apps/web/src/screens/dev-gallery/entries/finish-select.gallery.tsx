import { useState } from 'react';
import type { ContentKey, FinishOption } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { FinishSelectView } from '@/screens/match-lab/result/FinishSelect';
import { FINISH_RESET_MESSAGE } from '@/screens/match-lab/result/resultText';
import { DRAW_FINISHES, SINGLES_FINISHES } from '@/screens/match-lab/result/simulationFixtures';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

interface ExampleProps {
  readonly title: string;
  readonly finishes: readonly FinishOption[];
  readonly initial?: ContentKey | null;
  readonly notice?: string;
}

function Example({ title, finishes, initial = null, notice }: ExampleProps) {
  const [value, setValue] = useState<ContentKey | null>(initial);
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={office['stage']}>
        <div className={office['sideColumn']}>
          <FinishSelectView
            finishes={finishes}
            value={value}
            notice={notice ?? null}
            onValueChange={setValue}
          />
        </div>
      </div>
    </section>
  );
}

function FinishSelectDemo() {
  return (
    <Stack gap={5}>
      <Example title="Auto, every finish of a singles match" finishes={SINGLES_FINISHES} />
      <Example
        title="After Draw: the draw finishes, one booked"
        finishes={DRAW_FINISHES}
        initial={DRAW_FINISHES[1]?.key ?? null}
      />
      <Example
        title="Reset to Auto, announced"
        finishes={SINGLES_FINISHES}
        notice={FINISH_RESET_MESSAGE}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'finish-select',
  title: 'FinishSelect',
  group: 'Office',
  notes:
    'The Match lab\'s Finish choice (MTCH2-04): Auto first, then each finish the match may end with, "(no title change)" where a title would stay put, the booked finish\'s summary under it, and a polite live region for the reset message. In the lab it reads match.finishes; here the lists are hand-made.',
  render: () => <FinishSelectDemo />,
};
