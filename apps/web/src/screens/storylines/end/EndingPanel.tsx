import type { StorylineDetail, StorylinePayoffRecord } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { formatGameDate } from '@/components/format';
import { Panel } from '@/components/Panel';
import { WhyButton } from '@/components/Trace';
import { PayoffMemberList } from './PayoffPreview';
import type { PayoffMemberLine } from './PayoffPreview';
import { noPayoffRecordText, OLD_SAVE_PAYOFF_TEXT } from './payoffText';
import styles from './EndingPanel.module.css';

export const PAID_TITLE = 'Payoff';

/** Someone in the record the page no longer lists (it shouldn't happen: members freeze at the end). */
const UNKNOWN_MEMBER = 'Someone who was in it';

export const SKIPPED_RECORD_TEXT = 'Nothing: they had left, or there was no fan base to notice';

/** The record's members as lines, named from the page's member lists. */
export function recordMemberLines(
  storyline: StorylineDetail,
  record: StorylinePayoffRecord,
): PayoffMemberLine[] {
  const members = new Map(
    [...storyline.faces, ...storyline.heels, ...storyline.neutrals].map((member) => [
      member.personId,
      member,
    ]),
  );
  return record.members.map((member) => {
    const known = members.get(member.personId);
    return {
      personId: member.personId,
      name: known?.name ?? UNKNOWN_MEMBER,
      imageRef: known?.imageRef ?? null,
      popularity: { value: member.popularityDelta, trace: null },
      momentum: { value: member.momentumDelta, trace: null },
      skippedReason: member.skipped ? SKIPPED_RECORD_TEXT : null,
    };
  });
}

/**
 * An ended storyline's Ending panel: what its payoff paid each member (with the payoff's Why?),
 * or "No payoff (needs N linked segments, had M)", or, for a storyline that ended in an old save
 * before payoffs existed, a line saying so.
 */
export function EndingPanel({ storyline }: { readonly storyline: StorylineDetail }) {
  const { ending } = storyline;
  const payoff = useEngineQuery(
    'storylines.payoff',
    { storylineId: storyline.id },
    { enabled: ending !== null },
  );
  if (ending === null) return null;
  const view = payoff.data;
  const counted =
    view?.kind === 'paid' || view?.kind === 'noPayoff'
      ? view.record.countedSegments
      : ending.linkedSegments;
  return (
    <Panel title="Ending">
      <div className={styles['body']}>
        {view === undefined ? (
          <p className={styles['muted']}>Loading what it paid…</p>
        ) : view.kind === 'paid' ? (
          <>
            <p className={styles['title']}>
              {PAID_TITLE}
              {view.traceRef !== null && (
                <WhyButton
                  label={PAID_TITLE}
                  value={storyline.name}
                  source={{ traceRef: view.traceRef }}
                  buttonLabel="Why this payoff?"
                />
              )}
            </p>
            <PayoffMemberList members={recordMemberLines(storyline, view.record)} />
          </>
        ) : view.kind === 'noPayoff' ? (
          <p className={styles['title']}>
            {noPayoffRecordText(ending.minSegments, view.record.countedSegments)}
            {view.traceRef !== null && (
              <WhyButton
                label={PAID_TITLE}
                value={storyline.name}
                source={{ traceRef: view.traceRef }}
                buttonLabel="Why no payoff?"
              />
            )}
          </p>
        ) : (
          <p className={styles['title']}>{OLD_SAVE_PAYOFF_TEXT}</p>
        )}
        <p className={styles['muted']}>
          Ended {formatGameDate(ending.endedOn)} with {String(counted)} linked{' '}
          {counted === 1 ? 'segment' : 'segments'}.
        </p>
      </div>
    </Panel>
  );
}
