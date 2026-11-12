import type { GameDate, PreviewResult } from '@ringside/engine';
import { DURATION_CLASS_LABELS, SLOT_ROLE_LABELS } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { formatGameDate, formatNumber } from '@/components/format';
import { ScoreBug } from '@/components/ScoreBug';
import type { ScoreBugStats } from '@/components/ScoreBug';
import { StarRating, STAR_RATING_MAX } from '@/components/StarRating';
import { Explained, WhyButton } from '@/components/Trace';
import { expectationGapText, starsText, weightText } from './labText';
import styles from './MatchLab.module.css';

/** The badge on a result whose setup changed since its Run. */
export const OUT_OF_DATE_TEXT = 'Out of date: run again';

/** The stars as the glyphs draw them: a raised cap can go past five, the glyphs can't. */
function glyphStars(stars: number): number {
  return Math.min(STAR_RATING_MAX, Math.max(0, Math.round(stars * 4) / 4));
}

export interface LabResultProps {
  readonly result: PreviewResult;
  /** The game date the result was rated on. */
  readonly ratedOn: GameDate | null;
  /** The game's date now: a result from an earlier day says when it was rated. */
  readonly today: GameDate | null;
  /** The setup, the sides or the winner and finish changed since the Run. */
  readonly outOfDate: boolean;
}

/**
 * One rated night: Score, Stars, Work rate (or Talk) and Crowd on a score bug, each with its Why?,
 * then what the crowd expected against what it got, the slot and the rules it was rated under.
 */
export function LabResult({ result, ratedOn, today, outOfDate }: LabResultProps) {
  const performance =
    result.workRate !== null
      ? { id: 'workRate', label: 'Work rate', traced: result.workRate }
      : result.talk !== null
        ? { id: 'talk', label: 'Talk', traced: result.talk }
        : null;
  const expected = result.expectation.value;
  const crowd = result.crowd.value;

  const score = {
    id: 'score',
    label: 'Score',
    value: formatNumber(result.score.value),
    tone: 'data' as const,
    highlight: true,
    why: <WhyButton label="Score" value={result.score.value} source={result.score} />,
  };
  const stars = {
    id: 'stars',
    label: 'Stars',
    value: <StarRating value={glyphStars(result.stars.value)} size="md" tone="broadcast" />,
    subValue: starsText(result.stars.value),
    tone: 'prestige' as const,
    why: <WhyButton label="Stars" value={result.stars.value} unit="stars" source={result.stars} />,
  };
  const crowdStat = {
    id: 'crowd',
    label: 'Crowd',
    value: formatNumber(crowd),
    subValue: `Expected ${formatNumber(expected)}`,
    why: <WhyButton label="Crowd" value={crowd} source={result.crowd} />,
  };
  const stats: ScoreBugStats =
    performance === null
      ? [score, stars, crowdStat]
      : [
          score,
          stars,
          {
            id: performance.id,
            label: performance.label,
            value: formatNumber(performance.traced.value),
            why: (
              <WhyButton
                label={performance.label}
                value={performance.traced.value}
                source={performance.traced}
              />
            ),
          },
          crowdStat,
        ];

  const { slot } = result;
  const earlierDay = ratedOn !== null && today !== null && ratedOn !== today;

  return (
    <div className={styles['result']}>
      {outOfDate && (
        <p className={styles['outOfDate']} role="status">
          <Badge tone="prestige" variant="solid">
            {OUT_OF_DATE_TEXT}
          </Badge>
          <span>The setup changed since this run.</span>
        </p>
      )}
      <ScoreBug label="Lab result" stats={stats} className={styles['scoreBug']} />
      <p className={styles['resultLine']}>
        <span>Crowd expected</span>
        <Explained
          label="Crowd expectation"
          value={Math.round(expected)}
          trace={result.expectation.trace}
        />
        <span aria-hidden="true">·</span>
        <span>got</span>
        <Explained label="Crowd" value={Math.round(crowd)} trace={result.crowd.trace} />
        <span aria-hidden="true">·</span>
        <span>{expectationGapText(crowd, expected)}</span>
      </p>
      <p className={styles['resultLine']}>
        <span>{SLOT_ROLE_LABELS[slot.role]}</span>
        <span aria-hidden="true">·</span>
        <span>{DURATION_CLASS_LABELS[slot.durationClass]}</span>
        <WhyButton
          label="Duration class"
          value={DURATION_CLASS_LABELS[slot.durationClass]}
          source={slot.durationTrace}
        />
        <span aria-hidden="true">·</span>
        <span>weight {weightText(slot.weight)}</span>
        <WhyButton
          label="Slot weight"
          value={slot.weight}
          unit="multiplier"
          source={slot.weightTrace}
        />
      </p>
      <p className={styles['resultMeta']}>
        <span>{result.policy.label}</span>
        {earlierDay && <span>Rated on {formatGameDate(ratedOn, 'long')}</span>}
      </p>
    </div>
  );
}
