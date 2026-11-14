import { useId } from 'react';
import { PUSH_LABELS } from '@ringside/engine';
import type { AskingTerms } from '@ringside/engine';
import { formatNumber } from '@/components/format';
import { Explained } from '@/components/Trace';
import styles from './Negotiation.module.css';

export interface AskPanelProps {
  readonly ask: AskingTerms;
}

/**
 * What the worker asks of your promotion, every number with its Why?: the wage or the fee by the
 * kind asked about, the signing bonus, their market value, the perks they insist on, the length
 * they prefer, the card position they expect and how patient they will be.
 */
export function AskPanel({ ask }: AskPanelProps) {
  const headingId = useId();
  const perAppearance = ask.kind === 'perAppearance';
  return (
    <section className={styles['askPanel']} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles['sectionHeading']}>
        Their ask
      </h3>
      <dl className={styles['facts']}>
        <div className={styles['fact']}>
          <dt>{perAppearance ? 'Fee per appearance' : 'Monthly wage'}</dt>
          <dd>
            {perAppearance ? (
              <Explained
                value={ask.perAppearanceFee.value}
                unit="money"
                label="Their fee per appearance"
                trace={ask.perAppearanceFee.trace}
              />
            ) : (
              <Explained
                value={ask.monthlyWage.value}
                unit="money"
                label="Their monthly wage"
                trace={ask.monthlyWage.trace}
              />
            )}
          </dd>
        </div>
        <div className={styles['fact']}>
          <dt>Signing bonus</dt>
          <dd>
            <Explained
              value={ask.signingBonus.value}
              unit="money"
              label="Their signing bonus"
              trace={ask.signingBonus.trace}
            />
          </dd>
        </div>
        <div className={styles['fact']}>
          <dt>Market value</dt>
          <dd>
            <Explained
              value={ask.marketValue.value}
              unit="money"
              label="Their market value"
              trace={ask.marketValue.trace}
            />
          </dd>
        </div>
        <div className={styles['fact']}>
          <dt>Preferred length</dt>
          <dd>
            <Explained
              value={`${formatNumber(ask.preferredLengthMonths.value)} months`}
              label="Their preferred length"
              trace={ask.preferredLengthMonths.trace}
            />
          </dd>
        </div>
        <div className={styles['fact']}>
          <dt>Expects</dt>
          <dd>
            <Explained
              value={PUSH_LABELS[ask.expectedPush.value]}
              label="The card position they expect"
              trace={ask.expectedPush.trace}
            />
          </dd>
        </div>
        <div className={styles['fact']}>
          <dt>Patience</dt>
          <dd>
            <Explained
              value={`${formatNumber(ask.startPatience.value)} rounds`}
              label="Their patience"
              trace={ask.startPatience.trace}
            />
          </dd>
        </div>
        {ask.appearanceCap !== null && (
          <div className={styles['fact']}>
            <dt>Most appearances</dt>
            <dd>
              <Explained
                value={`${formatNumber(ask.appearanceCap.value)} a year`}
                label="The most appearances they agree to"
                trace={ask.appearanceCap.trace}
              />
            </dd>
          </div>
        )}
      </dl>
      {ask.perks.length > 0 && (
        <ul className={styles['perks']} aria-label="Perks they insist on">
          {ask.perks.map((perk) => (
            <li key={perk.term}>
              <strong>{perk.label}</strong>
              {`: ${perk.reason}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
