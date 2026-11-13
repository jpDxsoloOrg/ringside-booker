import type { PromotionId } from '@ringside/engine';
import { PromotionProfileLink } from '@/app/entityLinks';
import { classNames } from '../classNames';
import styles from './PromotionLink.module.css';

export interface PromotionLinkProps {
  readonly promotionId: PromotionId;
  /** The name to show: the promotion name the screen already has. */
  readonly name: string;
  /**
   * Keeps the name on one line, cut with an ellipsis, for table cells and cards. The link still
   * carries the whole name and shows it as a tooltip. Off by default.
   */
  readonly truncate?: boolean;
  readonly className?: string | undefined;
}

/**
 * A promotion's name as a link to its profile (`/game/promotions/:promotionId`): the same link
 * the "Why?" panels draw for promotions. From the Promotions list it remembers the list's sort,
 * and the profile's back link returns to it. The promotion twin of `WorkerLink`.
 */
export function PromotionLink({
  promotionId,
  name,
  truncate = false,
  className,
}: PromotionLinkProps) {
  return (
    <PromotionProfileLink
      promotionId={promotionId}
      className={classNames(styles['promotionLink'], truncate && styles['truncate'], className)}
      {...(truncate ? { title: name } : {})}
    >
      {name}
    </PromotionProfileLink>
  );
}
