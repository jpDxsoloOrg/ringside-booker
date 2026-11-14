import { Children, isValidElement, useId } from 'react';
import type { ReactNode } from 'react';
import { useIsMobile } from '@/styles/useMediaQuery';
import { classNames } from '../classNames';
import { formatNumber } from '../format';
import { Icon } from '../Icon';
import { ImageSlot } from '../ImageSlot';
import type { ImageSubject } from '../ImageSlot';
import styles from './ChampionCard.module.css';

/** Title prestige runs 0–100 in the engine; the card shows it as up to five stars as well. */
export const PRESTIGE_MAX = 100;
export const PRESTIGE_STAR_COUNT = 5;

const STAR_KEYS = Array.from(
  { length: PRESTIGE_STAR_COUNT },
  (_, index) => `star-${String(index)}`,
);

/** Prestige kept to 0–100; a missing or non-finite value counts as 0. */
export function clampPrestige(prestige: number): number {
  if (!Number.isFinite(prestige)) return 0;
  return Math.min(Math.max(prestige, 0), PRESTIGE_MAX);
}

/** How many of the five stars a prestige value fills: one per 20 points, rounded, clamped. */
export function prestigeStars(prestige: number): number {
  return Math.round((clampPrestige(prestige) / PRESTIGE_MAX) * PRESTIGE_STAR_COUNT);
}

/** A reign length in words: `1 day`, `142 days`, `1,204 days`. */
export function formatReignDays(days: number): string {
  return `${formatNumber(days)} ${days === 1 ? 'day' : 'days'}`;
}

export type ChampionCardHeadingLevel = 2 | 3 | 4;

const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

/** The title, as an image subject without its kind: the card always draws it as a belt. */
export type ChampionCardTitle = Omit<ImageSubject, 'kind'>;

/** The current reign. Left out (or `null` on the card) means the title is vacant. */
export interface ChampionCardReign {
  /** The champion: a person, or a team drawn with a person placeholder until teams get art. */
  readonly champion: ImageSubject;
  /** Days held so far. */
  readonly days: number;
  /** Successful defences in this reign. */
  readonly defences: number;
}

export interface ChampionCardProps {
  readonly title: ChampionCardTitle;
  /** The current reign, or `null` for a vacant title. */
  readonly reign: ChampionCardReign | null;
  /** Title prestige, 0–100. Shown as a number and as up to five gold stars. */
  readonly prestige: number;
  /** Heading level for the title name, so the card fits the page outline. 3 by default. */
  readonly headingLevel?: ChampionCardHeadingLevel;
  /** A small line at the bottom, such as "Next defence: Summit Night". */
  readonly footer?: ReactNode;
  /** Slot for a Why? chip, such as one that explains the prestige. */
  readonly why?: ReactNode;
  /**
   * Slot after the Why? chip for the card's actions, such as the Titles screen's menu on the
   * player's own titles. Left out, the card has no controls of its own.
   */
  readonly actions?: ReactNode;
  /**
   * Draws the title name, so a screen can make it a link (the Titles screen links it to the
   * title's page) without the card knowing about the router. Plain text by default.
   */
  readonly renderTitleName?: (name: string) => ReactNode;
  /** Draws the champion's name, so a screen can link it to their profile. Plain text by default. */
  readonly renderChampionName?: (name: string) => ReactNode;
  readonly className?: string | undefined;
}

function PrestigeStars({ prestige }: { readonly prestige: number }) {
  const filled = prestigeStars(prestige);
  return (
    <span className={styles['stars']} aria-hidden="true" data-stars={filled}>
      {STAR_KEYS.map((key, index) => (
        <Icon
          key={key}
          name="star"
          size="inherit"
          className={index < filled ? styles['starFilled'] : styles['starEmpty']}
          decorative
        />
      ))}
    </span>
  );
}

/**
 * A title and its current champion, office register: the belt (ImageSlot title art, gold unless
 * the title says otherwise), the title name, the champion with their picture, the reign length,
 * successful defences and prestige. A vacant title says so instead of showing a reign. It is an
 * article named by the title. Show several in a `ChampionCardList`.
 */
export function ChampionCard({
  title,
  reign,
  prestige,
  headingLevel = 3,
  footer,
  why,
  actions,
  renderTitleName,
  renderChampionName,
  className,
}: ChampionCardProps) {
  const headingId = useId();
  const Heading = HEADING_TAGS[headingLevel];
  const belt: ImageSubject = { ...title, kind: 'title', tier: title.tier ?? 'gold' };
  const prestigeText = formatNumber(clampPrestige(prestige));

  return (
    <article
      aria-labelledby={headingId}
      className={classNames(styles['championCard'], reign === null && styles['vacant'], className)}
      data-vacant={reign === null || undefined}
    >
      <div className={styles['header']}>
        <span className={styles['belt']}>
          <ImageSlot subject={belt} size="md" shape="square" decorative />
        </span>
        <div className={styles['titleBlock']}>
          <Heading id={headingId} className={styles['titleName']}>
            {renderTitleName === undefined ? title.name : renderTitleName(title.name)}
          </Heading>
          <span className={styles['prestige']}>
            <PrestigeStars prestige={prestige} />
            <span className={styles['prestigeText']}>Prestige {prestigeText}</span>
          </span>
        </div>
        {(why !== undefined || actions !== undefined) && (
          <span className={styles['why']}>
            {why}
            {actions}
          </span>
        )}
      </div>

      <div className={styles['holder']}>
        {reign === null ? (
          <p className={styles['vacantText']}>Vacant</p>
        ) : (
          <>
            <ImageSlot subject={reign.champion} size="sm" decorative />
            <div className={styles['holderText']}>
              <span className={styles['holderLabel']}>Champion</span>
              <span className={styles['holderName']}>
                {renderChampionName === undefined
                  ? reign.champion.name
                  : renderChampionName(reign.champion.name)}
              </span>
            </div>
          </>
        )}
      </div>

      {reign !== null && (
        <dl className={styles['stats']}>
          <div className={styles['stat']}>
            <dt className={styles['statLabel']}>Reign</dt>
            <dd className={styles['statValue']}>{formatReignDays(reign.days)}</dd>
          </div>
          <div className={styles['stat']}>
            <dt className={styles['statLabel']}>Defences</dt>
            <dd className={styles['statValue']}>{formatNumber(reign.defences)}</dd>
          </div>
        </dl>
      )}

      {footer !== undefined && <div className={styles['footer']}>{footer}</div>}
    </article>
  );
}

/** How a `ChampionCardList` lays its cards out below `--bp-mobile`. */
export type ChampionCardPhoneLayout = 'swipe' | 'stack';

export interface ChampionCardListProps {
  /** Names the list for screen readers, such as "Champions". */
  readonly label: string;
  /**
   * On a phone: `swipe` (the default), one horizontal row that scrolls inside itself, for a short
   * strip such as the Office's; `stack`, one card per row down the page, for a screen that is all
   * cards such as Titles.
   */
  readonly phoneLayout?: ChampionCardPhoneLayout;
  /** The `ChampionCard`s. */
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

/**
 * Lays champion cards out: a wrapping grid on desktop and, below `--bp-mobile`, a horizontal
 * swipe row with each card snapping into place (or one column with `phoneLayout="stack"`). The
 * swipe row is a keyboard-focusable region, so it can be scrolled with the arrow keys as well as by
 * swiping.
 */
export function ChampionCardList({
  label,
  phoneLayout = 'swipe',
  children,
  className,
}: ChampionCardListProps) {
  const isMobile = useIsMobile();
  const cards = Children.toArray(children);
  const swipes = isMobile && phoneLayout === 'swipe';
  const layout = isMobile ? phoneLayout : 'grid';
  return (
    <div
      role="region"
      aria-label={label}
      // A scrolling region with no focusable content must take focus itself, or the keyboard
      // cannot scroll it (WCAG 2.1.1). Only the swipe row scrolls, so only it is a tab stop.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={swipes ? 0 : undefined}
      className={classNames(
        styles['list'],
        phoneLayout === 'swipe' ? styles['swipe'] : styles['stack'],
        className,
      )}
      data-layout={layout}
    >
      <ul className={styles['listItems']}>
        {cards.map((card, index) => (
          <li
            key={isValidElement(card) && card.key !== null ? card.key : `card-${String(index)}`}
            className={styles['listItem']}
          >
            {card}
          </li>
        ))}
      </ul>
    </div>
  );
}
