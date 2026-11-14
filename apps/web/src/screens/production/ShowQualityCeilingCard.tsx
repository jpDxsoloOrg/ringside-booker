/**
 * EVT4's card in the Production header (ECO7-05): the show-quality ceiling that stage, camera,
 * editing and pyro set, with its Why?, and whether it is high enough for the bonus main-card slot.
 * The numbers come from EVT4's `production.ceiling` query; the formula stays with card flow. It
 * sits first in the header, at order 10.
 */
import type { EventImportance, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { formatNumber } from '@/components/format';
import { KpiCard } from '@/components/KpiCard';
import { WhyButton } from '@/components/Trace';
import { registerBuiltinProductionHeaderItem } from './productionHeaderRegistry';
import styles from './ProductionScreen.module.css';

export const SHOW_QUALITY_CEILING_HEADER_ID = 'cardFlow.showQualityCeiling';
export const SHOW_QUALITY_CEILING_HEADER_ORDER = 10;
export const SHOW_QUALITY_CEILING_LABEL = 'Show quality ceiling';

/** "regular shows and bigger", "flagship shows". */
export function bonusSlotShowsText(minImportance: EventImportance): string {
  return minImportance === 'flagship' ? 'flagship shows' : `${minImportance} shows and bigger`;
}

/**
 * "Bonus slot on regular shows and bigger: unlocked" or "Bonus slot on regular shows and bigger:
 * at 90, yours 47".
 */
export function bonusSlotLineText(
  qualifies: boolean,
  threshold: number,
  ceiling: number,
  minImportance: EventImportance,
): string {
  const head = `Bonus slot on ${bonusSlotShowsText(minImportance)}`;
  return qualifies
    ? `${head}: unlocked`
    : `${head}: at ${formatNumber(threshold)}, yours ${formatNumber(ceiling)}`;
}

export interface ShowQualityCeilingCardProps {
  readonly promotionId: PromotionId;
}

/** The ceiling and the bonus-slot line. Nothing while it loads or if it is refused. */
export function ShowQualityCeilingCard({ promotionId }: ShowQualityCeilingCardProps) {
  const answer = useEngineQuery('production.ceiling', { promotionId });
  const view = answer.data;
  if (view === undefined) return null;
  const { ceiling, ceilingTrace, bonusSlot } = view;
  const line = bonusSlotLineText(
    bonusSlot.qualifies,
    bonusSlot.threshold,
    ceiling,
    bonusSlot.minImportance,
  );
  return (
    <KpiCard
      label={SHOW_QUALITY_CEILING_LABEL}
      icon="trophy"
      value={formatNumber(ceiling)}
      unit="/100"
      footer={
        <span className={styles['footerLine']}>
          {bonusSlot.qualifies && <Badge tone="positive">Bonus slot</Badge>}
          <span>{line}</span>
        </span>
      }
      why={
        <WhyButton
          label={SHOW_QUALITY_CEILING_LABEL}
          value={ceiling}
          unit="points"
          source={{ trace: ceilingTrace }}
        />
      }
    />
  );
}

registerBuiltinProductionHeaderItem({
  id: SHOW_QUALITY_CEILING_HEADER_ID,
  order: SHOW_QUALITY_CEILING_HEADER_ORDER,
  render: ({ promotionId }) => <ShowQualityCeilingCard promotionId={promotionId} />,
});
