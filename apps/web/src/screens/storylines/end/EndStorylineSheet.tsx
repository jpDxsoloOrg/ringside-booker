import { useState } from 'react';
import type { GameDate, PersonId, StorylineDetail } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { queryErrorText, reasonsText } from '../storylineText';
import { PayoffPreview } from './PayoffPreview';
import styles from './EndStorylineSheet.module.css';

export const PAYOFF_LOADING_TEXT = 'Working out what ending it now would pay…';

/** Portraits by person, from the page's member lists. */
export function memberImageRefs(storyline: StorylineDetail): ReadonlyMap<PersonId, string | null> {
  return new Map(
    [...storyline.faces, ...storyline.heels, ...storyline.neutrals].map((member) => [
      member.personId,
      member.imageRef,
    ]),
  );
}

/**
 * Shows still to run that have segments linked to the storyline, in date order: ending it now
 * means those segments no longer count. `today` is the next day to play.
 */
export function stillBookedShows(storyline: StorylineDetail, today: GameDate | null): string[] {
  if (today === null) return [];
  const shows: string[] = [];
  for (const entry of storyline.timeline) {
    if (entry.stars === null && entry.date >= today && !shows.includes(entry.eventName)) {
      shows.push(entry.eventName);
    }
  }
  return shows;
}

export interface EndStorylineSheetProps {
  readonly storyline: StorylineDetail;
  readonly today: GameDate | null;
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * Ending a storyline (CRTV3-04's End, with CRTV4-05's payoff preview): a sheet from the side on
 * desktop and from the bottom on a phone, showing what ending it now pays each member with a Why?
 * on every number, or why it pays nothing. "End storyline" ends it, the payoff is applied, and
 * the page then shows what was paid.
 */
export function EndStorylineSheet({ storyline, today, open, onClose }: EndStorylineSheetProps) {
  const end = useEngineCommand('storylines.end');
  const [problem, setProblem] = useState<string | null>(null);
  const payoff = useEngineQuery(
    'storylines.payoff',
    { storylineId: storyline.id },
    { enabled: open, keepPreviousData: false },
  );
  const close = (): void => {
    if (end.pending) return;
    setProblem(null);
    onClose();
  };
  const confirm = async (): Promise<void> => {
    setProblem(null);
    const result = await end.run({ storylineId: storyline.id });
    if (!result.ok) {
      setProblem(reasonsText(result.reasons));
      return;
    }
    onClose();
  };

  let body;
  if (payoff.data === undefined) {
    body = (
      <p className={styles['muted']}>
        {payoff.status === 'loading' ? PAYOFF_LOADING_TEXT : queryErrorText(payoff.error)}
      </p>
    );
  } else if (payoff.data.kind !== 'preview') {
    body = (
      <p className={styles['muted']}>
        {payoff.data.kind === 'unavailable'
          ? payoff.data.reason.message
          : `${storyline.name} has already ended.`}
      </p>
    );
  } else {
    body = (
      <PayoffPreview
        plan={payoff.data.plan}
        imageRefs={memberImageRefs(storyline)}
        stillBookedShows={stillBookedShows(storyline, today)}
      />
    );
  }
  const ready = payoff.data?.kind === 'preview';

  return (
    <Sheet
      open={open}
      onClose={close}
      title={`End ${storyline.name}?`}
      size="md"
      footer={
        <div className={styles['footer']}>
          <Button onClick={close} disabled={end.pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={end.pending}
            disabled={!ready}
            onClick={() => {
              void confirm();
            }}
          >
            End storyline
          </Button>
        </div>
      }
    >
      <div className={styles['body']}>
        <p className={styles['lead']}>
          Ending it is final: the storyline can&rsquo;t be changed again.
        </p>
        {body}
        {problem !== null && (
          <p role="alert" className={styles['problem']}>
            {problem}
          </p>
        )}
      </div>
    </Sheet>
  );
}
