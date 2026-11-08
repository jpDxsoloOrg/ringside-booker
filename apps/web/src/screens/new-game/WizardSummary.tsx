import type { ReactNode } from 'react';
import { cents } from '@ringside/engine';
import type { WorldPreview } from '@ringside/engine';
import { formatGameDate, formatNumber, useMoneyFormatter } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import type { DraftSnapshot } from './draftModel';
import {
  changedSettings,
  chosenPromotion,
  findRegion,
  normaliseShortName,
  seasonLengthLabel,
  seasonOneWindow,
} from './draftModel';
import { codeLabel, settingValueLabel, WEEKDAY_LABELS } from './labels';
import { foundedLogoId } from './steps/FoundPromotionForm';
import styles from './WizardSummary.module.css';

export interface WizardSummaryProps {
  readonly draft: DraftSnapshot;
  /** The chosen world's preview, or null before one has loaded. */
  readonly preview: WorldPreview | null;
  /** `compact` for the side panel; `full` on the Review step adds season 1's dates and more. */
  readonly variant: 'compact' | 'full';
}

function SummaryRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className={styles['row']}>
      <dt className={styles['label']}>{label}</dt>
      <dd className={styles['value']}>{children}</dd>
    </div>
  );
}

/** The promotion the player will run: a chosen one with its figures, or the one being founded. */
function PromotionSummary({
  draft,
  preview,
}: {
  readonly draft: DraftSnapshot;
  readonly preview: WorldPreview;
}) {
  const formatMoney = useMoneyFormatter();
  if (draft.player.mode === 'found') {
    const { found } = draft.player;
    const name = found.name.trim();
    const shortName = normaliseShortName(found.shortName);
    const home = findRegion(preview, found.homeRegionKey);
    const numbers = preview.foundingSizes[found.size];
    return (
      <div className={styles['promotion']}>
        <ImageSlot
          subject={{
            kind: 'promotion',
            id: foundedLogoId(found.shortName),
            name: name === '' ? 'Your promotion' : name,
            shortName,
          }}
          size="md"
          decorative
        />
        <div className={styles['promotionText']}>
          <span className={styles['promotionName']}>
            {name === '' ? 'Your new promotion' : name}
            {shortName !== '' && ` (${shortName})`}
          </span>
          <span className={styles['muted']}>
            Founded · {codeLabel(found.size)} · {formatMoney(cents(numbers.cash))}
          </span>
          <span className={styles['muted']}>
            {home === null ? 'No home region yet' : `${home.region.name}, ${home.countryName}`}
          </span>
          {found.starterKit && (
            <span className={styles['muted']}>
              Starter kit: weekly show on {WEEKDAY_LABELS[found.weeklyShowDay]}s
            </span>
          )}
        </div>
      </div>
    );
  }
  const promotion = chosenPromotion(draft, preview);
  if (promotion === null) return <span className={styles['muted']}>Not chosen yet</span>;
  return (
    <div className={styles['promotion']}>
      <ImageSlot
        subject={{
          kind: 'promotion',
          id: promotion.key,
          name: promotion.name,
          shortName: promotion.shortName,
        }}
        size="md"
        decorative
      />
      <div className={styles['promotionText']}>
        <span className={styles['promotionName']}>{promotion.name}</span>
        <span className={styles['muted']}>{formatMoney(cents(promotion.cash))} cash</span>
        <span className={styles['muted']}>
          {promotion.homeRegion.name}, {promotion.homeCountry.name}
        </span>
      </div>
    </div>
  );
}

/**
 * What the new game will be, as chosen so far: the world, the promotion, the season length, the
 * settings changed from their defaults and the seed. The side panel on desktop; the top of the
 * Review step on every screen.
 */
export function WizardSummary({ draft, preview, variant }: WizardSummaryProps) {
  if (preview === null) {
    return <p className={styles['muted']}>Choose a world to begin.</p>;
  }
  const lengthLabel = seasonLengthLabel(draft, preview);
  const seasonOne = seasonOneWindow(draft, preview);
  const changed = changedSettings(draft, preview);
  return (
    <dl className={styles['summary']} data-variant={variant}>
      <SummaryRow label="World">{preview.manifest.name}</SummaryRow>
      <SummaryRow label="Promotion">
        <PromotionSummary draft={draft} preview={preview} />
      </SummaryRow>
      <SummaryRow label="Season length">{lengthLabel ?? 'Not valid yet'}</SummaryRow>
      {variant === 'full' && seasonOne !== null && (
        <SummaryRow label="Season 1">
          {formatGameDate(seasonOne.start, 'short')} – {formatGameDate(seasonOne.end, 'short')} (
          {formatNumber(seasonOne.lengthDays)} days)
        </SummaryRow>
      )}
      <SummaryRow label="Settings">
        {changed.length === 0 ? (
          <span className={styles['muted']}>All at their defaults</span>
        ) : (
          <ul className={styles['settingList']}>
            {changed.map(({ definition, value }) => (
              <li key={definition.key}>
                {definition.label}: {settingValueLabel(value)}
              </li>
            ))}
          </ul>
        )}
      </SummaryRow>
      <SummaryRow label="Seed">
        <code className={styles['seed']}>{draft.seed}</code>
      </SummaryRow>
    </dl>
  );
}
