import { addMonths, cents, compareDates } from '@ringside/engine';
import type { DealRow, DealValuation, GameDate, PromotionId, Reason } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { DeltaChip } from '@/components/DeltaChip';
import { formatGameDate, formatSignedMoney } from '@/components/format';
import type { MoneyFormatter } from '@/components/format';
import { Select } from '@/components/Select';
import { Explained } from '@/components/Trace';
import { VerdictBadge } from './components/VerdictBadge';
import {
  DEAL_LENGTH_MONTHS,
  LOSES_MONEY_TEXT,
  monthsText,
  perBuyText,
  perThousandLabel,
  PPV_AIRTIME_TEXT,
} from './networkText';
import styles from './Networks.module.css';

/** When a renewal would end: the months counted from the current end date, or today if later. */
export function renewedEndsOn(endsOn: GameDate, today: GameDate, months: number): GameDate {
  return addMonths(compareDates(endsOn, today) > 0 ? endsOn : today, months);
}

export interface RenegotiateViewProps {
  readonly promotionId: PromotionId;
  readonly deal: DealRow;
  readonly months: number;
  readonly onMonthsChange: (months: number) => void;
  readonly today: GameDate | null;
  readonly money: MoneyFormatter;
  /** The engine's refusal of the last Renew, shown in words. */
  readonly refusals: readonly Reason[];
}

interface TermLine {
  readonly label: string;
  readonly current: number;
  readonly next: DealValuation['terms']['feePerShow'];
  readonly goodWhen: 'up' | 'down';
  readonly perBuy: boolean;
}

/**
 * Renewing a deal: pick a length, and see the network's terms today next to the current ones
 * (fee, per thousand or per buy, airtime), the new end date, what each airing would leave you
 * with, and whether the network would sign, all with their Why?. Reads `broadcast.valuation` for
 * the deal's own network, show, timeslot and live, with `dealId`.
 */
export function RenegotiateView({
  promotionId,
  deal,
  months,
  onMonthsChange,
  today,
  money,
  refusals,
}: RenegotiateViewProps) {
  const preview = useEngineQuery(
    'broadcast.valuation',
    {
      promotionId,
      networkId: deal.networkId,
      eventDefinitionId: deal.eventDefinitionId,
      timeslot: deal.timeslot,
      live: deal.live,
      months,
      dealId: deal.dealId,
    },
    { keepPreviousData: true },
  );
  const valuation = preview.data;
  const signed = (amount: number): string => formatSignedMoney(cents(amount), { showPlus: true });
  const lines: readonly TermLine[] =
    valuation === undefined
      ? []
      : [
          ...(deal.kind === 'ppv'
            ? []
            : [
                {
                  label: 'Fee per show',
                  current: deal.terms.feePerShow,
                  next: valuation.terms.feePerShow,
                  goodWhen: 'up' as const,
                  perBuy: false,
                },
              ]),
          {
            label: perThousandLabel(deal.kind),
            current: deal.terms.perThousandViewers,
            next: valuation.terms.perThousandViewers,
            goodWhen: 'up',
            perBuy: deal.kind === 'ppv',
          },
          {
            label: 'Airtime cost per show',
            current: deal.terms.costPerShow,
            next: valuation.terms.costPerShow,
            goodWhen: 'down',
            perBuy: false,
          },
        ];

  return (
    <div className={styles['sheetBody']}>
      <Select
        label="Length"
        options={DEAL_LENGTH_MONTHS.map((value) => ({
          value: String(value),
          label: monthsText(value),
        }))}
        value={String(months)}
        onValueChange={(value) => {
          onMonthsChange(Number(value));
        }}
      />
      {valuation === undefined ? (
        <p role="status" className={styles['muted']}>
          {preview.status === 'error'
            ? ((preview.error?.kind === 'rejected' ? preview.error.reasons[0]?.message : null) ??
              'The network could not be asked.')
            : 'Asking the network…'}
        </p>
      ) : (
        <>
          <table className={styles['compare']}>
            <caption className={styles['visuallyHidden']}>Current terms against new terms</caption>
            <thead>
              <tr>
                <th scope="col">Term</th>
                <th scope="col">Now</th>
                <th scope="col">Renewed</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.label}>
                  <th scope="row">{line.label}</th>
                  <td className="tabular">
                    {line.perBuy ? perBuyText(line.current) : money(cents(line.current))}
                  </td>
                  <td>
                    <span className={styles['compareNew']}>
                      {line.perBuy ? (
                        <span className="tabular">{perBuyText(line.next.value)}</span>
                      ) : (
                        <Explained
                          value={line.next.value}
                          unit="money"
                          label={`Renewed ${line.label.toLowerCase()}`}
                          trace={line.next.trace}
                        />
                      )}
                      <DeltaChip
                        value={line.next.value - line.current}
                        display={signed(line.next.value - line.current)}
                        goodWhen={line.goodWhen}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className={styles['terms']}>
            <div>
              <dt>New end date</dt>
              <dd>
                {today === null
                  ? formatGameDate(valuation.endsOn)
                  : formatGameDate(renewedEndsOn(deal.endsOn, today, months))}
              </dd>
            </div>
            <div>
              <dt>Income per airing</dt>
              <dd>
                <Explained
                  value={valuation.incomePerAiring.value}
                  unit="money"
                  label="Income per airing after renewing"
                  trace={valuation.incomePerAiring.trace}
                />
              </dd>
            </div>
          </dl>
          {valuation.incomePerAiring.value < 0 && (
            <p className={styles['lossNote']}>{LOSES_MONEY_TEXT}</p>
          )}
          {deal.kind === 'ppv' && valuation.terms.costPerShow.value > deal.terms.costPerShow && (
            <p className={styles['tradeOff']}>
              {PPV_AIRTIME_TEXT} Renewed, it is {money(cents(valuation.terms.costPerShow.value))} a
              show, up from {money(cents(deal.terms.costPerShow))}.
            </p>
          )}
          <VerdictBadge
            verdict={valuation.verdict}
            refusals={valuation.refusals}
            trace={valuation.verdictTrace}
            networkName={deal.networkName}
            showReason={false}
          />
          {valuation.refusals.length > 0 && (
            <ul className={styles['reasons']}>
              {valuation.refusals.map((refusal) => (
                <li key={refusal.code}>{refusal.message}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {refusals.length > 0 && (
        <div role="alert" className={styles['refusal']}>
          {refusals.map((reason) => (
            <p key={`${reason.code}:${reason.message}`}>{reason.message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
