import type { StorylineMemberView } from '@ringside/engine';
import { Badge } from '../Badge';
import { classNames } from '../classNames';
import { ImageSlot } from '../ImageSlot';
import { SlashDivider } from '../SlashDivider';
import { StorylineSideChip } from '../StorylineSideChip';
import styles from './StorylineCard.module.css';

/** The warning chip on a member who no longer works for the storyline's promotion. */
export const LEFT_PROMOTION_TEXT = 'Left the promotion';

/** What an empty side says. */
export const EMPTY_SIDE_TEXT = 'No one yet';

export interface StorylineSidesProps {
  readonly faces: readonly StorylineMemberView[];
  readonly heels: readonly StorylineMemberView[];
  readonly neutrals: readonly StorylineMemberView[];
  readonly className?: string | undefined;
}

interface SideListProps {
  readonly label: string;
  readonly members: readonly StorylineMemberView[];
  readonly className?: string | undefined;
}

function SideList({ label, members, className }: SideListProps) {
  return (
    <ul className={classNames(styles['sideList'], className)} aria-label={label}>
      {members.length === 0 ? (
        <li className={styles['emptySide']}>{EMPTY_SIDE_TEXT}</li>
      ) : (
        members.map((member) => (
          <li key={member.personId} className={styles['member']}>
            <ImageSlot
              subject={{
                kind: 'person',
                id: member.personId,
                name: member.name,
                ...(member.imageRef === null ? {} : { imageRef: member.imageRef }),
              }}
              size="xs"
              decorative
            />
            {/* Plain text until the worker profile route is on main (CRTV3-05 links it). */}
            <span className={styles['memberName']} title={member.name}>
              {member.name}
            </span>
            <StorylineSideChip side={member.side} />
            {!member.stillEmployed && (
              <Badge tone="negative" className={styles['memberWarning']}>
                {LEFT_PROMOTION_TEXT}
              </Badge>
            )}
          </li>
        ))
      )}
    </ul>
  );
}

/**
 * A storyline's people by side: faces, a slash, heels, and any neutrals in a row below. Faces sit
 * left of the slash and heels right of it on desktop; below --bp-mobile the faces stack above the
 * heels (CSS only). Every member shows their side in words, and one who left the promotion says so.
 */
export function StorylineSides({ faces, heels, neutrals, className }: StorylineSidesProps) {
  return (
    <div className={classNames(styles['sides'], className)}>
      <div className={styles['matchup']}>
        <SideList label="Faces" members={faces} className={styles['faces']} />
        <SlashDivider variant="inline" className={styles['matchupSlash']} />
        <SideList label="Heels" members={heels} className={styles['heels']} />
      </div>
      {neutrals.length > 0 && (
        <SideList label="Neutral" members={neutrals} className={styles['neutrals']} />
      )}
    </div>
  );
}
