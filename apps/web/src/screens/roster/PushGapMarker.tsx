import type { PushVerdict } from '@ringside/engine';
import { classNames } from '@/components/classNames';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import styles from './RosterScreen.module.css';

interface MarkerLook {
  readonly icon: IconName;
  readonly text: string;
  readonly className: string;
}

/** The marker for each verdict; a worker where they expect to be gets none. */
const MARKERS: Readonly<Record<PushVerdict, MarkerLook | null>> = {
  expectsMore: { icon: 'up', text: 'Expects more', className: 'markerWarning' },
  aboveExpected: { icon: 'down', text: 'Above expectations', className: 'markerMuted' },
  asExpected: null,
};

/** The visible words of a verdict's marker, or null when it shows none. */
export function pushGapMarkerText(verdict: PushVerdict): string | null {
  return MARKERS[verdict]?.text ?? null;
}

export interface PushGapMarkerProps {
  readonly verdict: PushVerdict;
}

/**
 * Beside the push a wrestler expects: an up arrow and "Expects more" when they sit lower on the
 * card than they expect, a down arrow and "Above expectations" when they sit higher. The words
 * are always there, so the marker never relies on its colour. Screen readers hear the whole cell
 * as one sentence instead (see `ExpectsCell`), so the marker itself is hidden from them.
 */
export function PushGapMarker({ verdict }: PushGapMarkerProps) {
  const marker = MARKERS[verdict];
  if (marker === null) return null;
  return (
    <span className={classNames(styles['marker'], styles[marker.className])} aria-hidden>
      <Icon name={marker.icon} decorative />
      {marker.text}
    </span>
  );
}
