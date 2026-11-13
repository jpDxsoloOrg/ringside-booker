import type { PromotionProfile, Redacted } from '@ringside/engine';
import { cents } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import {
  formatNumber,
  formatPopularity,
  roundPopularity,
  useMoneyFormatter,
} from '@/components/format';
import type { MoneyFormatter } from '@/components/format';
import { KpiCard, KpiCardGrid } from '@/components/KpiCard';
import { NeedsList } from '@/components/NeedsList';
import { Panel } from '@/components/Panel';
import { PopularityDrilldown } from '@/components/PopularityDrilldown';
import { WhyButton } from '@/components/Trace';
import { CompanySizeKpi } from '@/screens/finances/kpis';
import { RecentTitleChangesPanel } from '../overview/RecentTitleChangesPanel';
import type { PromotionTabContext } from '../promotionTabs';
import styles from '../PromotionProfile.module.css';

/** What the Cash card says: the figure, a band label, or "Private" for a rival's money. */
export function cashText(cash: Redacted, formatMoney: MoneyFormatter): string {
  switch (cash.kind) {
    case 'exact':
      return formatMoney(cents(cash.value));
    case 'band':
      return cash.label;
    case 'hidden':
      return 'Private';
  }
}

/** Why the Rival rules do not apply to a promotion, or null when they do. */
export function fullRulesReason(rules: PromotionProfile['rules']): string | null {
  if (rules.inForce) return null;
  return rules.levelPlayingField
    ? 'Plays by the full rules: this game was started with the level playing field.'
    : 'Plays by the full rules: rival shortcuts apply only to promotions run by the computer.';
}

function NeedsPanel({ promotionId }: Pick<PromotionTabContext, 'promotionId'>) {
  const needs = useEngineQuery('aip.needs', { promotionId });
  return (
    <Panel
      title="Needs"
      headingLevel={2}
      subtitle="What a rival desk would say this roster is short of"
    >
      {needs.status === 'loading' ? (
        <p className={styles['muted']}>Working out the needs…</p>
      ) : needs.data === undefined ? (
        <EmptyState
          icon="warning"
          size="inline"
          headingLevel={3}
          title="The needs could not be worked out"
        />
      ) : (
        <NeedsList needs={needs.data} />
      )}
    </Panel>
  );
}

function RulesPanel({ rules }: { readonly rules: PromotionProfile['rules'] }) {
  const reason = fullRulesReason(rules);
  return (
    <Panel
      title="Rival rules"
      headingLevel={2}
      subtitle="The computer’s shortcuts for this promotion"
    >
      {reason !== null ? (
        <p>{reason}</p>
      ) : (
        <ul className={styles['ruleList']} aria-label="Shortcuts in force">
          {rules.shortcuts.map((shortcut) => {
            const state =
              typeof shortcut.value === 'number' && shortcut.on
                ? `+${formatNumber(shortcut.value)}`
                : shortcut.on
                  ? 'On'
                  : 'Off';
            return (
              <li key={shortcut.key} className={styles['ruleItem']}>
                <span>{shortcut.label}</span>
                <span className={styles['ruleState']}>
                  <Badge tone={shortcut.on ? 'data' : 'neutral'}>{state}</Badge>
                  <WhyButton
                    label={`Rival shortcut ${shortcut.label}`}
                    value={state}
                    source={{ trace: shortcut.trace }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The profile's first tab: the key numbers (popularity at home and worldwide with their Why?,
 * prestige, roster, champions, shows a month, company size and cash, which is "Private" for a
 * rival), what the roster is short of, the Rival rules as they apply here, the recent title
 * changes and the popularity drill-down.
 */
export function OverviewTab({ profile, promotionId }: PromotionTabContext) {
  const formatMoney = useMoneyFormatter();
  const { kpis, header } = profile;
  const home = roundPopularity(kpis.popularityHome.value);
  const world = roundPopularity(kpis.popularityWorld.value);
  return (
    <div className={styles['tab']}>
      <KpiCardGrid label="Key numbers">
        <KpiCard
          label="Popularity at home"
          value={formatPopularity(home)}
          footer={header.homeCountry.name}
          why={
            <WhyButton
              label={`Popularity in ${header.homeCountry.name}`}
              value={home}
              unit="points"
              source={{ trace: kpis.popularityHome.trace }}
            />
          }
        />
        <KpiCard
          label="Popularity worldwide"
          value={formatPopularity(world)}
          why={
            <WhyButton
              label="Worldwide popularity"
              value={world}
              unit="points"
              source={{ trace: kpis.popularityWorld.trace }}
            />
          }
        />
        <KpiCard label="Prestige" value={formatNumber(kpis.prestige)} />
        <KpiCard
          label="Roster"
          value={formatNumber(kpis.rosterCount)}
          footer={`${formatNumber(kpis.crewCount)} crew`}
        />
        <KpiCard label="Champions" value={formatNumber(kpis.championCount)} />
        <KpiCard
          label="Shows a month"
          value={formatNumber(kpis.showsPerMonth)}
          footer="Next four weeks"
        />
        {/* ECO1's public size band with its Why? (AIP1-07), the same card as the Finances screen. */}
        <CompanySizeKpi promotionId={promotionId} />
        <KpiCard
          label="Cash"
          value={cashText(kpis.cash, formatMoney)}
          tone={kpis.cash.kind === 'exact' && kpis.cash.value < 0 ? 'negative' : 'neutral'}
          {...(kpis.cash.kind === 'hidden' ? { footer: 'Only its owner sees this' } : {})}
        />
      </KpiCardGrid>
      <div className={styles['columns']}>
        <NeedsPanel promotionId={promotionId} />
        <RulesPanel rules={profile.rules} />
      </div>
      {/* AIP5-05: who won which title lately and why. */}
      <RecentTitleChangesPanel promotionId={promotionId} />
      <Panel title="Popularity by place" headingLevel={2}>
        <PopularityDrilldown rollup={profile.popularity} subjectName={header.name} />
      </Panel>
    </div>
  );
}
