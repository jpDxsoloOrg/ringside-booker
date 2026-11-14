import type { AnswerReleaseResult, ContractDetail, OwnContractDetail } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { ContractStatusChip } from '@/components/ContractStatusChip';
import { formatGameDate, formatNumber, formatPercent, formatSigned } from '@/components/format';
import { Explained } from '@/components/Trace';
import { EMPLOYMENT_ROLE_LABELS } from '@/screens/promotions/profile/tabs/RosterTab';
import { NO_VALUE, pushLabel } from '@/screens/roster/labels';
import {
  CONTRACT_KIND_LABELS,
  CONTRACT_PERK_LABELS,
  contractStatusesOf,
  NO_END_DATE,
} from './contractLabels';
import { ReleaseRequestPanel } from './ReleaseRequestPanel';
import type { ContractRules } from './useContractRules';
import styles from './ContractsScreen.module.css';
import { useContractMoney } from './useContractMoney';

/** What a rival's contract says where the money would be. */
export const TERMS_PRIVATE_TEXT = 'Terms private';

/** "Renews automatically for a year until contract talks arrive" (the ECO4-02 stopgap). */
export function autoRenewText(days: number): string {
  const span = days === 365 ? 'a year' : `${formatNumber(days)} days`;
  return `Renews automatically for ${span} until contract talks arrive.`;
}

function basisPoints(bp: number): string {
  return formatPercent(bp / 10_000, bp % 100 === 0 ? 0 : 1);
}

function daysText(days: number): string {
  return `${formatNumber(days)} ${days === 1 ? 'day' : 'days'}`;
}

/** The sections every contract shows: who, which promotion, kind, dates. */
function DatesSection({ detail }: { readonly detail: ContractDetail }) {
  return (
    <section className={styles['section']} aria-label="Dates">
      <h3 className={styles['sectionTitle']}>Dates</h3>
      <dl className={styles['terms']}>
        <div>
          <dt>Starts</dt>
          <dd>{formatGameDate(detail.startsOn)}</dd>
        </div>
        <div>
          <dt>Ends</dt>
          <dd>{detail.endsOn === null ? NO_END_DATE : formatGameDate(detail.endsOn)}</dd>
        </div>
        {detail.daysLeft !== null && (
          <div>
            <dt>Days left</dt>
            <dd className="tabular">{daysText(detail.daysLeft)}</dd>
          </div>
        )}
        {detail.endedOn !== null && (
          <div>
            <dt>Ended</dt>
            <dd>{formatGameDate(detail.endedOn)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function TitlesSection({ detail }: { readonly detail: ContractDetail }) {
  if (detail.titles.length === 0) return null;
  return (
    <section className={styles['section']} aria-label="Titles held">
      <h3 className={styles['sectionTitle']}>Titles held</h3>
      <p className={styles['badges']}>
        {detail.titles.map((title) => (
          <Badge key={title.id} tone="prestige">
            {title.name}
          </Badge>
        ))}
      </p>
    </section>
  );
}

function OwnTerms({ detail }: { readonly detail: OwnContractDetail }) {
  const money = useContractMoney();
  const { shares } = detail;
  return (
    <section className={styles['section']} aria-label="Terms">
      <h3 className={styles['sectionTitle']}>Terms</h3>
      <dl className={styles['terms']}>
        <div>
          <dt>Kind</dt>
          <dd>
            {CONTRACT_KIND_LABELS[detail.kind]}
            {detail.exclusive ? ', exclusive' : ''}
          </dd>
        </div>
        <div>
          <dt>Wage</dt>
          <dd className="tabular">{`${money(detail.monthlyWage)} a month`}</dd>
        </div>
        <div>
          <dt>Per appearance</dt>
          <dd className="tabular">{money(detail.perAppearanceFee)}</dd>
        </div>
        <div>
          <dt>Signing bonus</dt>
          <dd className="tabular">{money(detail.signingBonus)}</dd>
        </div>
        <div>
          <dt>Shares</dt>
          <dd>
            {`Gate ${basisPoints(shares.gateBp)} · Merch ${basisPoints(shares.merchBp)} · TV ${basisPoints(shares.broadcastBp)}`}
          </dd>
        </div>
        <div>
          <dt>Appearance cap</dt>
          <dd>
            {detail.appearanceCap === null
              ? 'None'
              : `${formatNumber(detail.appearanceCap)} a year`}
          </dd>
        </div>
        <div>
          <dt>Perks</dt>
          <dd>
            {detail.perks.length === 0
              ? 'None'
              : detail.perks.map((perk) => CONTRACT_PERK_LABELS[perk]).join(', ')}
          </dd>
        </div>
        {detail.severance !== null && (
          <div>
            <dt>Release today</dt>
            <dd>
              <Explained
                value={detail.severance.value}
                unit="money"
                label={`${detail.ringName}'s severance today`}
                trace={detail.severance.trace}
              />
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** Morale (the stored value; WRK8 adds the chip) and the unhappy clock with its Why?. */
function MoraleSection({ detail }: { readonly detail: OwnContractDetail }) {
  const { unhappy } = detail;
  return (
    <section className={styles['section']} aria-label="Morale">
      <h3 className={styles['sectionTitle']}>Morale</h3>
      <dl className={styles['terms']}>
        <div>
          <dt>Morale</dt>
          <dd className="tabular">{formatSigned(detail.morale)}</dd>
        </div>
        {unhappy !== null && (
          <div>
            <dt>Unhappy</dt>
            <dd>
              {unhappy.paused ? (
                <span className={styles['requestLine']}>
                  Clock paused: in a hot storyline
                  <Explained
                    value={unhappy.days}
                    unit="days"
                    label={`${detail.ringName}'s unhappy days`}
                    traceRef={unhappy.traceRef}
                  />
                </span>
              ) : (
                <span className={styles['requestLine']}>
                  <Explained
                    value={unhappy.days}
                    unit="days"
                    label={`${detail.ringName}'s unhappy days`}
                    traceRef={unhappy.traceRef}
                  />
                  {`of ${formatNumber(unhappy.of)} days before asking to leave`}
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export interface ContractDetailViewProps {
  readonly detail: ContractDetail;
  readonly rules: ContractRules;
  readonly onAnswered: (result: AnswerReleaseResult) => void;
}

/**
 * Everything about one contract, for the Contracts sheet and the profile's Contract tab. Your own
 * contract shows every term, morale and any release request; a rival's shows only who, where,
 * the kind and the dates, with "Terms private".
 */
export function ContractDetailView({ detail, rules, onAnswered }: ContractDetailViewProps) {
  const role = EMPLOYMENT_ROLE_LABELS[detail.role];
  const push = pushLabel(detail.push);
  const subtitle = `${push === NO_VALUE ? role : `${push} ${role.toLowerCase()}`} at ${detail.promotionName}`;

  if (detail.termsPrivate) {
    return (
      <div className={styles['detail']}>
        <p className={styles['muted']}>{subtitle}</p>
        <dl className={styles['terms']}>
          <div>
            <dt>Kind</dt>
            <dd>{CONTRACT_KIND_LABELS[detail.kind]}</dd>
          </div>
        </dl>
        <DatesSection detail={detail} />
        <p className={styles['private']}>{TERMS_PRIVATE_TEXT}</p>
      </div>
    );
  }

  const statuses = contractStatusesOf(
    { ...detail, endReason: null },
    rules.expiringSoonDays,
    rules.expiringWindowDays,
  );
  const live = detail.status === 'active' || detail.status === 'signed';
  return (
    <div className={styles['detail']}>
      <p className={styles['muted']}>{subtitle}</p>
      {live && (
        <p className={styles['badges']}>
          {statuses.map((status) => (
            <ContractStatusChip key={status.kind} status={status} />
          ))}
        </p>
      )}
      <ReleaseRequestPanel
        detail={detail}
        settlesAbove={rules.settlesAbove}
        onAnswered={onAnswered}
      />
      <OwnTerms detail={detail} />
      <DatesSection detail={detail} />
      {live && rules.autoRenew && detail.endsOn !== null && (
        <p className={styles['muted']}>{autoRenewText(rules.autoRenewDays)}</p>
      )}
      <TitlesSection detail={detail} />
      <MoraleSection detail={detail} />
    </div>
  );
}
