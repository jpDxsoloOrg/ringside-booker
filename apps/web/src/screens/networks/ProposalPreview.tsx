import { cents } from '@ringside/engine';
import type { DealValuation, NetworkKind } from '@ringside/engine';
import { formatNumber, useMoneyFormatter } from '@/components/format';
import { KpiCard, KpiCardGrid } from '@/components/KpiCard';
import { WhyButton } from '@/components/Trace';
import { VerdictBadge } from './components/VerdictBadge';
import { LOSES_MONEY_TEXT, perBuyText, perThousandLabel, PPV_AIRTIME_TEXT } from './networkText';
import styles from './Networks.module.css';

export interface ProposalPreviewProps {
  readonly valuation: DealValuation;
  readonly kind: NetworkKind;
  readonly networkName: string;
}

/**
 * What a network would do with a proposal, before signing: projected viewers against what it
 * expects, the fee, the per-thousand (or per-buy) rate, the airtime you pay, and what each airing
 * leaves you with, every number with its Why?; then the verdict with its Why? and every reason it
 * would refuse. A deal that loses money on each airing says so in words, and a pay-per-view deal
 * says what its airtime costs: both are the player's call, not hidden.
 */
export function ProposalPreview({ valuation, kind, networkName }: ProposalPreviewProps) {
  const money = useMoneyFormatter();
  const { terms } = valuation;
  const income = valuation.incomePerAiring.value;
  return (
    <div className={styles['preview']}>
      <KpiCardGrid label="What the network would do">
        <KpiCard
          label="Projected viewers"
          value={formatNumber(valuation.projectedViewers.value)}
          why={
            <WhyButton
              label="Projected viewers"
              value={valuation.projectedViewers.value}
              unit="count"
              source={{ trace: valuation.projectedViewers.trace }}
            />
          }
        />
        <KpiCard
          label="Network expects"
          value={formatNumber(valuation.benchmark.value)}
          why={
            <WhyButton
              label={`What ${networkName} expects`}
              value={valuation.benchmark.value}
              unit="count"
              source={{ trace: valuation.benchmark.trace }}
            />
          }
        />
        <KpiCard
          label="Fee per show"
          value={kind === 'ppv' ? '—' : money(cents(terms.feePerShow.value))}
          {...(kind === 'ppv' ? { footer: 'Pay-per-view pays per buy' } : {})}
          why={
            <WhyButton
              label="Fee per show"
              value={terms.feePerShow.value}
              unit="money"
              source={{ trace: terms.feePerShow.trace }}
            />
          }
        />
        <KpiCard
          label={perThousandLabel(kind)}
          value={
            kind === 'ppv'
              ? perBuyText(terms.perThousandViewers.value)
              : money(cents(terms.perThousandViewers.value), { showCents: true })
          }
          why={
            <WhyButton
              label={perThousandLabel(kind)}
              value={terms.perThousandViewers.value}
              unit="money"
              source={{ trace: terms.perThousandViewers.trace }}
            />
          }
        />
        <KpiCard
          label="Airtime cost"
          value={money(cents(terms.costPerShow.value))}
          unit="/show"
          why={
            <WhyButton
              label="Airtime cost"
              value={terms.costPerShow.value}
              unit="money"
              source={{ trace: terms.costPerShow.trace }}
            />
          }
        />
        <KpiCard
          label="Income per airing"
          value={money(cents(income))}
          tone={income < 0 ? 'negative' : 'neutral'}
          why={
            <WhyButton
              label="Income per airing"
              value={income}
              unit="money"
              source={{ trace: valuation.incomePerAiring.trace }}
            />
          }
        />
      </KpiCardGrid>
      {income < 0 && <p className={styles['lossNote']}>{LOSES_MONEY_TEXT}</p>}
      {kind === 'ppv' && (
        <p className={styles['tradeOff']}>
          {PPV_AIRTIME_TEXT} This deal costs {money(cents(terms.costPerShow.value))} of airtime a
          show.
        </p>
      )}
      {valuation.becomesTelevised && (
        <p className={styles['muted']}>Signing makes this show a TV show.</p>
      )}
      <div className={styles['verdictLine']}>
        <VerdictBadge
          verdict={valuation.verdict}
          refusals={valuation.refusals}
          trace={valuation.verdictTrace}
          networkName={networkName}
          showReason={false}
        />
      </div>
      {valuation.refusals.length > 0 && (
        <ul className={styles['reasons']} aria-label={`Why ${networkName} would refuse`}>
          {valuation.refusals.map((refusal) => (
            <li key={refusal.code}>{refusal.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
