import type { VenueFit } from '@ringside/engine';
import { Badge } from '../Badge';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import type { RoleTone } from '../tone';

interface FitLook {
  readonly label: string;
  readonly tone: RoleTone;
  readonly icon: IconName;
}

/** How each fit reads: the engine's label, a colour role and an icon, so colour is never alone. */
export const VENUE_FIT_LOOKS: Readonly<Record<VenueFit, FitLook>> = {
  likelySellOut: { label: 'Likely sell-out', tone: 'positive', icon: 'ticket' },
  goodFit: { label: 'Good fit', tone: 'data', icon: 'check' },
  willLookEmpty: { label: 'Will look empty', tone: 'negative', icon: 'warning' },
};

export interface VenueFitBadgeProps {
  /** How well the venue suits the expected crowd, from `boxOffice.forecast` or `boxOffice.venues`. */
  readonly fit: VenueFit;
  readonly className?: string | undefined;
}

/**
 * How well a venue suits a show's expected crowd: "Likely sell-out", "Good fit" or "Will look
 * empty", each with its own icon and colour role. The engine decides the fit (`venueFit`).
 */
export function VenueFitBadge({ fit, className }: VenueFitBadgeProps) {
  const look = VENUE_FIT_LOOKS[fit];
  return (
    <Badge tone={look.tone} className={className}>
      <Icon name={look.icon} size="sm" decorative />
      {look.label}
    </Badge>
  );
}
