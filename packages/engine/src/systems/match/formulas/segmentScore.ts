/**
 * Segment score: the 0–100 number a segment adds to the show.
 *
 * A blend of the performance (work rate for a match, talk for a talking segment) and the crowd.
 * How much each counts depends on the kind of wrestling the promotion is known for: a technical
 * promotion leans on work rate, an entertainment one on the crowd. Talking segments use one share
 * for every promotion. A policy bonus (0 in MTCH1, "Same rules for every promotion") comes last.
 *
 * Design: docs/design/match-rating.md#segment-score.
 */

import { startCalc, type Traced } from '../../../core/trace';
import type { PromotionStyle } from '../../../model/entities/promotion-style';
import type { SegmentKind } from '../../../model/entities/segment';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { signedNumber, summaryOf } from './shared';

export const SEGMENT_SCORE_DOC_REF = 'match-rating.md#segment-score';

/** What the performance half of a segment is called: work rate in a match, talk in an angle. */
export const SEGMENT_PERFORMANCE_LABELS: Readonly<Record<SegmentKind, string>> = {
  match: 'Work rate',
  angle: 'Talk',
};

/** Promotion styles as the player reads them. */
export const PROMOTION_STYLE_LABELS: Readonly<Record<PromotionStyle, string>> = {
  mainstream: 'Mainstream',
  traditional: 'Traditional',
  technical: 'Technical',
  hardHitting: 'Hard-hitting',
  hardcore: 'Hardcore',
  highFlying: 'High-flying',
  entertainment: 'Entertainment',
};

/** The policy line until a promotion's policies can change a score. */
export const DEFAULT_POLICY_LABEL = 'Same rules for every promotion';

export const SEGMENT_SCORE_LABEL = 'Segment score';

export interface SegmentScoreInputs {
  kind: SegmentKind;
  /** Work rate for a match, talk for a talking segment, after compression. */
  performance: Traced<number>;
  /** The crowd score, after compression. */
  crowd: Traced<number>;
  promotionStyle: PromotionStyle;
  /** A flat bonus from the promotion's policies; 0 for now. */
  policyBonus: Traced<number>;
  /** The policy line's text, such as "Same rules for every promotion". */
  policyLabel: string;
}

const WORK_RATE_SHARE_KEYS = {
  mainstream: 'match.blend.workRateShare.mainstream',
  traditional: 'match.blend.workRateShare.traditional',
  technical: 'match.blend.workRateShare.technical',
  hardHitting: 'match.blend.workRateShare.hardHitting',
  hardcore: 'match.blend.workRateShare.hardcore',
  highFlying: 'match.blend.workRateShare.highFlying',
  entertainment: 'match.blend.workRateShare.entertainment',
} as const satisfies Readonly<Record<PromotionStyle, NumberTunableKey>>;

const SCORE_MIN = 0;
const SCORE_MAX = 100;

/**
 * `performance × share + crowd × (1 − share) + policyBonus`, rounded to the nearest whole number and
 * kept between 0 and 100. The share is `match.blend.workRateShare.<style>` for a match and
 * `match.angle.talkShare` for a talking segment.
 */
export function segmentScore(
  inputs: SegmentScoreInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const performanceLabel = SEGMENT_PERFORMANCE_LABELS[inputs.kind];

  const performancePart = startCalc(
    `${performanceLabel}'s share`,
    summaryOf(inputs.performance, performanceLabel, 'points'),
    { unit: 'points' },
  );
  const styleLabel = PROMOTION_STYLE_LABELS[inputs.promotionStyle];
  const share =
    inputs.kind === 'match'
      ? performancePart.tunable(
          tunables,
          WORK_RATE_SHARE_KEYS[inputs.promotionStyle],
          `${styleLabel} work rate share`,
        )
      : performancePart.tunable(tunables, 'match.angle.talkShare', 'Talk share');
  performancePart.multiply(
    inputs.kind === 'match' ? `${styleLabel} promotion` : 'Talking segment',
    share,
  );

  const crowdShare = 1 - share;
  const crowdPart = startCalc("Crowd's share", summaryOf(inputs.crowd, 'Crowd', 'points'), {
    unit: 'points',
  }).multiply('What the performance leaves', crowdShare);

  return startCalc(SEGMENT_SCORE_LABEL, 0, {
    unit: 'points',
    docRef: SEGMENT_SCORE_DOC_REF,
    startLabel: 'Nothing yet',
  })
    .add(`${performanceLabel} × ${formatNumber(share)}`, performancePart.done())
    .add(`Crowd × ${formatNumber(crowdShare)}`, crowdPart.done())
    .add(`${inputs.policyLabel} ${signedNumber(inputs.policyBonus.value)}`, inputs.policyBonus)
    .round('round', 'Rounded to a whole number')
    .clamp(SCORE_MIN, SCORE_MAX)
    .done();
}
