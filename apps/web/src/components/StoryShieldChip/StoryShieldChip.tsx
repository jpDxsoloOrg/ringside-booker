import type { TraceNode } from '@ringside/engine';
import { Badge } from '../Badge';
import { classNames } from '../classNames';
import { formatNumber } from '../format';
import type { Tone } from '../tone';
import { WhyButton } from '../Trace';
import styles from './StoryShieldChip.module.css';

/** How hot the storyline was: a hot story shields fully, a warm one partly, a cool one not at all. */
export type StoryShieldBand = 'none' | 'warm' | 'hot';

export const NO_STORY_SHIELD_TEXT = 'No story shield';

/** The Why? panel's heading and the button's label. */
export const STORY_SHIELD_LABEL = 'Story shield';

export interface StoryShieldChipProps {
  /** How much of the morale hit of losing the story covers, 0 to 100. */
  readonly percent: number;
  readonly band: StoryShieldBand;
  /** The loss was in the storyline's finale. */
  readonly finale: boolean;
  /** The shield's breakdown; with none there is no Why? button. */
  readonly trace?: TraceNode | null;
  readonly className?: string;
}

const BAND_TONES: Readonly<Record<StoryShieldBand, Tone>> = {
  hot: 'positive',
  warm: 'prestige',
  none: 'neutral',
};

/** "Story shield 100%", "Story shield 25%" or "No story shield". */
export function storyShieldText(percent: number, band: StoryShieldBand): string {
  return band === 'none' ? NO_STORY_SHIELD_TEXT : `${STORY_SHIELD_LABEL} ${formatNumber(percent)}%`;
}

/**
 * How much a storyline covered a loss inside it: "Story shield 100%" (green) when the story was
 * hot, "Story shield 25%" (gold) when it was warm, "No story shield" otherwise, plus "in the
 * finale" when the loss was the story's finale. Props only: the results page passes WRK8's
 * numbers in (CRTV4-06). A Why? shows how the shield was worked out when a trace is given.
 */
export function StoryShieldChip({ percent, band, finale, trace, className }: StoryShieldChipProps) {
  const text = storyShieldText(percent, band);
  return (
    <span className={classNames(styles['chip'], className)} data-band={band}>
      <Badge tone={BAND_TONES[band]} variant={band === 'none' ? 'soft' : 'solid'}>
        {text}
      </Badge>
      {finale && <span className={styles['finale']}>in the finale</span>}
      {trace !== undefined && trace !== null && (
        <WhyButton
          label={STORY_SHIELD_LABEL}
          value={band === 'none' ? 0 : percent}
          unit="percent"
          source={{ trace }}
          buttonLabel={`Why ${text.toLowerCase()}?`}
        />
      )}
    </span>
  );
}
