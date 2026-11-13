import { PROMOTION_STYLE_LABELS } from '@ringside/engine';
import type { PromotionId, PromotionProfile } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { Badge } from '@/components/Badge';
import { ImageSlot } from '@/components/ImageSlot';
import { controlledByText, controlledByTone } from '../promotionLabels';
import { crestOf } from '../promotionColumns';
import styles from './PromotionProfile.module.css';

export interface PromotionHeaderProps {
  readonly promotionId: PromotionId;
  /** The `header` part of `promotions.profile`. */
  readonly header: PromotionProfile['header'];
  /**
   * `page` (the default) makes the name the screen's one `h1`; `section` makes it an `h3`, for
   * showing the header inside another page such as the component gallery.
   */
  readonly heading?: 'page' | 'section';
}

/** The year a promotion was founded, from its founding date. */
export function foundedYear(foundedOn: string): string {
  return foundedOn.slice(0, 4);
}

/**
 * The top of a promotion's profile: large crest, name (the page heading), short name, who runs it,
 * then style, home region and country, founding year and its brands with who runs each.
 */
export function PromotionHeader({ promotionId, header, heading = 'page' }: PromotionHeaderProps) {
  return (
    <header className={styles['header']}>
      <ImageSlot
        subject={crestOf({ promotionId, name: header.name, logoRef: header.logoRef })}
        size="lg"
        decorative
      />
      <div className={styles['identity']}>
        {heading === 'page' ? (
          <RouteHeading className={styles['heading']}>{header.name}</RouteHeading>
        ) : (
          <h3 className={styles['heading']}>{header.name}</h3>
        )}
        <p className={styles['shortName']}>{header.shortName}</p>
        <div className={styles['chips']}>
          <Badge tone={controlledByTone(header.controlledBy)}>
            {`Run by: ${controlledByText(header.controlledBy, null)}`}
          </Badge>
          {header.status !== 'active' && (
            <Badge tone="negative">{header.status === 'closed' ? 'Closed' : 'Dormant'}</Badge>
          )}
        </div>
      </div>
      <dl className={styles['facts']}>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Style</dt>
          <dd>{PROMOTION_STYLE_LABELS[header.style]}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Home</dt>
          <dd>{`${header.homeRegion.name}, ${header.homeCountry.name}`}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Founded</dt>
          <dd className="tabular">{foundedYear(header.foundedOn)}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Brands</dt>
          <dd>
            {header.brands.length === 0 ? (
              <span className={styles['muted']}>No brands</span>
            ) : (
              <ul className={styles['chips']} aria-label="Brands">
                {header.brands.map((brand) => (
                  <li key={brand.brandId}>
                    <Badge tone={controlledByTone(brand.controlledBy)}>
                      {brand.controlledBy === header.controlledBy
                        ? brand.name
                        : `${brand.name} (${controlledByText(brand.controlledBy, null)})`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </header>
  );
}
