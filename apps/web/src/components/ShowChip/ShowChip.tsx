import type { CalendarShow } from '@ringside/engine';
import { classNames } from '../classNames';
import { VisuallyHidden } from '../layout';
import { IMPORTANCE_LABELS } from './importance';
import styles from './ShowChip.module.css';
import { useShowChipBadges } from './showChipBadges';

/** `grid` is one tight line for a month cell; `row` is a full-width row for lists and agendas. */
export type ShowChipDensity = 'grid' | 'row';

/**
 * Which name the chip's tag carries: the show's brand (for a list of one promotion's shows), or
 * the promotion's short name (for a list that mixes promotions). A brand tag that would repeat the
 * show's own name is not drawn.
 */
export type ShowChipTag = 'brand' | 'promotion';

export interface ShowChipProps {
  /** The calendar row, stored or projected. */
  readonly show: CalendarShow;
  /** The player picked the chip: open the show. */
  readonly onOpen: (show: CalendarShow) => void;
  readonly density: ShowChipDensity;
  /** `brand` by default. */
  readonly tag?: ShowChipTag;
  readonly className?: string | undefined;
}

/** The words a chip shows for a show that will not happen, or null for one that still can. */
export function showChipStatusLabel(show: CalendarShow): string | null {
  if (show.status !== 'cancelled') return null;
  return show.cancellation?.reason === 'notRun' ? 'Not run' : 'Cancelled';
}

/**
 * The tag's words, or null for no tag. A brand named after its own weekly show would only repeat
 * the name beside it and squeeze both in a month cell, so that tag is left out.
 */
function tagTextOf(show: CalendarShow, tag: ShowChipTag): string | null {
  if (tag === 'promotion') return show.promotion.shortName;
  const brandName = show.brand?.name ?? null;
  return brandName === show.name ? null : brandName;
}

/** The promotion's own colour as a small dot. Decorative: the tag's text says who it is. */
function PromotionDot({ color }: { readonly color: string }) {
  return (
    <svg className={styles['dot']} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <circle cx="4" cy="4" r="4" fill={color} />
    </svg>
  );
}

/**
 * One show on a calendar: a bar and a tint in its importance colour, its name, and a tag saying
 * whose it is. The viewer's own shows have a solid edge and rivals' are muted. A show that will
 * not happen is struck through and says so in words, and a projected one has a dashed edge.
 *
 * It is a button; its accessible name is the full show name, its importance and everything else
 * the chip shows, so nothing depends on colour or on the name fitting.
 */
export function ShowChip({ show, onOpen, density, tag = 'brand', className }: ShowChipProps) {
  const badges = useShowChipBadges();
  const statusLabel = showChipStatusLabel(show);
  const tagText = tagTextOf(show, tag);

  return (
    <button
      type="button"
      className={classNames(styles['chip'], styles[`density-${density}`], className)}
      data-importance={show.importance}
      data-status={show.status}
      data-own={show.isOwn ? 'true' : 'false'}
      title={show.name}
      onClick={() => {
        onOpen(show);
      }}
    >
      <span className={styles['name']}>{show.name}</span>
      <VisuallyHidden>, {IMPORTANCE_LABELS[show.importance]}</VisuallyHidden>
      {statusLabel !== null && <span className={styles['status']}>{statusLabel}</span>}
      {show.status === 'projected' && <VisuallyHidden>, Projected</VisuallyHidden>}
      {tagText !== null && (
        <span className={styles['tag']}>
          <PromotionDot color={show.promotion.color} />
          <span className={styles['tagText']}>{tagText}</span>
        </span>
      )}
      {badges.map((badge) => {
        const content = badge.render({ show });
        return content === null || content === undefined || content === false ? null : (
          <span key={badge.id} className={styles['badge']}>
            {content}
          </span>
        );
      })}
    </button>
  );
}
