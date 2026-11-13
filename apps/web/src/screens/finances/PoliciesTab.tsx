import { useState } from 'react';
import { cents, POLICY_AREA_LABELS, POLICY_LEVEL_LABELS } from '@ringside/engine';
import type { PolicyLevel, PolicyView, PromotionId } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useMoneyFormatter } from '@/components/format';
import { Panel } from '@/components/Panel';
import { useIsMobile } from '@/styles/useMediaQuery';
import { FinanceQueryError } from './financeParts';
import { PolicyPicker } from './PolicyPicker';
import styles from './Finances.module.css';

export interface PoliciesTabProps {
  readonly promotionId: PromotionId;
}

interface PolicyPanelProps {
  readonly promotionId: PromotionId;
  readonly policy: PolicyView;
}

/** One area's panel: its four levels from `finance.policyPreview`, and the change command. */
function PolicyPanel({ promotionId, policy }: PolicyPanelProps) {
  const preview = useEngineQuery('finance.policyPreview', { promotionId, area: policy.area });
  const setPolicy = useEngineCommand('finance.setPolicy');
  const announce = useAnnounce();
  const isMobile = useIsMobile();
  const formatMoney = useMoneyFormatter();
  const [refusal, setRefusal] = useState<string | null>(null);
  const areaLabel = POLICY_AREA_LABELS[policy.area];

  const choose = async (level: PolicyLevel): Promise<void> => {
    setRefusal(null);
    const result = await setPolicy.run({ promotionId, area: policy.area, level });
    if (result.ok) {
      announce(`${areaLabel} policy set to ${POLICY_LEVEL_LABELS[result.data.to]}`);
    } else {
      setRefusal(result.reasons.map((reason) => reason.message).join(' '));
    }
  };

  return (
    <Panel
      title={areaLabel}
      subtitle={`Now ${policy.label}: about ${formatMoney(cents(policy.monthlyEstimate))} a month`}
      headingLevel={2}
    >
      {preview.data === undefined ? (
        preview.status === 'loading' ? (
          <p className={styles['muted']} role="status">
            Pricing the levels…
          </p>
        ) : (
          <FinanceQueryError error={preview.error} title="The levels can't be priced" />
        )
      ) : (
        <PolicyPicker
          preview={preview.data}
          description={policy.description}
          layout={isMobile ? 'column' : 'row'}
          disabled={setPolicy.pending}
          onChange={(level) => {
            void choose(level);
          }}
        />
      )}
      {refusal !== null && (
        <p className={styles['refusal']} role="alert">
          {refusal}
        </p>
      )}
    </Panel>
  );
}

/**
 * The Policies tab: Travel, Catering and Medical, each a choice of four levels with what it costs
 * a month. Choosing a level runs `finance.setPolicy`; the next costs follow it.
 */
export function PoliciesTab({ promotionId }: PoliciesTabProps) {
  const policies = useEngineQuery('finance.policies', { promotionId });
  if (policies.status === 'loading') {
    return (
      <p className={styles['muted']} role="status">
        Loading the policies…
      </p>
    );
  }
  if (policies.data === undefined) {
    return <FinanceQueryError error={policies.error} title="The policies can't be shown" />;
  }
  return (
    <div className={styles['tabBody']}>
      <p className={styles['lead']}>
        Travel and catering are paid on show nights, medical on the 1st of each month. A change
        applies from the next show or the next 1st. Estimates cover the next 30 days.
      </p>
      {policies.data.policies.map((policy) => (
        <PolicyPanel key={policy.area} promotionId={promotionId} policy={policy} />
      ))}
    </div>
  );
}
