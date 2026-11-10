import { PUSH_LABELS, RATING_ROLE_LABELS } from '@ringside/engine';
import type { Availability, WorkerProfile, WorkerProfilePlace } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { formatGameDate, formatNumber } from '@/components/format';
import { Panel } from '@/components/Panel';
import { ExplainedText } from '../ExplainedText';
import type { ProfileTabContext } from '../profileTabs';
import styles from '../WorkerProfile.module.css';

/** "Injured (leg injury). First day back: Tuesday, April 14, 2026." */
export function availabilitySentence(availability: Availability): string {
  const reason = `${availability.reason}.`;
  return availability.until === null
    ? reason
    : `${reason} First day back: ${formatGameDate(availability.until, 'long')}.`;
}

/** "7 years", "1 year" or "Less than a year": whole years in the business. */
export function experienceText(years: number): string {
  const whole = Math.floor(years);
  if (whole < 1) return 'Less than a year';
  return whole === 1 ? '1 year' : `${formatNumber(whole)} years`;
}

function placeText(place: WorkerProfilePlace): string {
  return `${place.regionName}, ${place.countryName}`;
}

function mainRating(profile: WorkerProfile): WorkerProfile['overall']['byRole'][number] | null {
  return profile.overall.byRole.find((rating) => rating.role === profile.overall.mainRole) ?? null;
}

/** The summary tab: how good they are, where they would sit on the card and who they are. */
export function OverviewTab({ profile }: ProfileTabContext) {
  const { header, expectedPush, traits, vices } = profile;
  const rating = mainRating(profile);
  const roleLabel = RATING_ROLE_LABELS[profile.overall.mainRole];
  const hasDebuted = header.debutDate !== null;

  return (
    <div className={styles['overview']}>
      <Panel title="Overall" headingLevel={2}>
        <div className={styles['overallBlock']}>
          {rating !== null && (
            <p className={styles['overallLine']}>
              <span className={styles['factLabel']}>{roleLabel}</span>
              <ExplainedText
                className={styles['bigNumber']}
                label={`${roleLabel} overall`}
                text={formatNumber(Math.round(rating.value))}
                trace={rating.trace}
              />
              <Badge tone="data">{rating.grade}</Badge>
            </p>
          )}
          {expectedPush !== null && (
            <p className={styles['expectedLine']}>
              <span>Would expect:</span>
              <ExplainedText
                label="Expected push"
                text={PUSH_LABELS[expectedPush.push]}
                trace={expectedPush.trace}
              />
              <span>at {expectedPush.promotionName}</span>
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Availability" headingLevel={2}>
        <p>{availabilitySentence(header.availability)}</p>
      </Panel>

      <Panel title="Traits" headingLevel={2}>
        {traits.length === 0 ? (
          <p className={styles['muted']}>No notable traits.</p>
        ) : (
          <ul className={styles['chipList']} aria-label="Traits">
            {traits.map((trait) => (
              <li key={trait.key}>
                <Badge>{trait.label}</Badge>
              </li>
            ))}
          </ul>
        )}
        <h3 className={styles['subheading']}>Known vices</h3>
        {vices.length === 0 ? (
          <p className={styles['muted']}>None known.</p>
        ) : (
          <ul className={styles['chipList']} aria-label="Known vices">
            {vices.map((vice) => (
              <li key={vice.kind}>
                <Badge tone={vice.state === 'recovering' ? 'positive' : 'warning'}>
                  {vice.label}: {vice.state === 'recovering' ? 'recovering' : 'known'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Background" headingLevel={2}>
        <dl className={styles['background']}>
          <div className={styles['fact']}>
            <dt className={styles['factLabel']}>Based in</dt>
            <dd>{placeText(header.basedIn)}</dd>
          </div>
          <div className={styles['fact']}>
            <dt className={styles['factLabel']}>Born</dt>
            <dd>{placeText(header.born)}</dd>
          </div>
          <div className={styles['fact']}>
            <dt className={styles['factLabel']}>Debut</dt>
            <dd>{header.debutDate === null ? 'Not debuted' : formatGameDate(header.debutDate)}</dd>
          </div>
          {hasDebuted && (
            <div className={styles['fact']}>
              <dt className={styles['factLabel']}>Experience</dt>
              <dd>{experienceText(header.experienceYears)}</dd>
            </div>
          )}
        </dl>
      </Panel>
    </div>
  );
}
