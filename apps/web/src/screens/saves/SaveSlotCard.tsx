import { forwardRef, useId } from 'react';
import { CURRENT_FORMAT_VERSION } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { classNames } from '@/components/classNames';
import { formatGameDate } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import type { ImageSubject } from '@/components/ImageSlot';
import { VisuallyHidden } from '@/components/layout';
import type { SlotRecord } from '@/storage';
import type { LoadFailureStage } from '@/worker/engineHost';
import styles from './SaveSlotsScreen.module.css';
import {
  formatRelativeTime,
  formatSaveSize,
  LOAD_STAGE_LABELS,
  slotPromotionName,
} from './slotFormat';

export interface SaveSlotCardProps {
  readonly slot: SlotRecord;
  /** The real-world time "Last played" counts back from. */
  readonly now: Date;
  /**
   * The stage a load of this slot failed at, when the file itself is unreadable (decode, parse,
   * format). The card then offers only Export and Delete.
   */
  readonly unreadableStage?: LoadFailureStage | null;
  /** This slot is loading. */
  readonly loading?: boolean;
  /** Another load is running, so this card's Load waits. */
  readonly loadDisabled?: boolean;
  /** This slot is being exported. */
  readonly exporting?: boolean;
  /** Just imported: drawn with a ring so the player spots it. */
  readonly highlighted?: boolean;
  readonly onLoad: () => void;
  readonly onExport: () => void;
  readonly onBackups: () => void;
  readonly onDelete: () => void;
}

/** The picture for a slot: the promotion's logo, or the save's initials while unemployed. */
function slotImage(slot: SlotRecord): ImageSubject {
  const { promotionName, promotionShortName } = slot.header;
  if (promotionName === null) {
    return { kind: 'person', id: slot.slotId, name: slot.label };
  }
  return {
    kind: 'promotion',
    id: slot.slotId,
    name: promotionName,
    ...(promotionShortName === null ? {} : { shortName: promotionShortName }),
  };
}

/**
 * One saved game in the slot list: its picture, label, promotion, game date, when it was last
 * played and its size, with Load as the main action and Export, Backups and Delete beside it.
 * A save whose file cannot be read shows why, and offers only Export and Delete.
 */
export const SaveSlotCard = forwardRef<HTMLElement, SaveSlotCardProps>(function SaveSlotCard(
  {
    slot,
    now,
    unreadableStage = null,
    loading = false,
    loadDisabled = false,
    exporting = false,
    highlighted = false,
    onLoad,
    onExport,
    onBackups,
    onDelete,
  },
  ref,
) {
  const headingId = useId();
  const needsUpgrade = slot.formatVersion < CURRENT_FORMAT_VERSION;
  const unreadable = unreadableStage !== null;

  return (
    <article
      ref={ref}
      aria-labelledby={headingId}
      aria-busy={loading ? true : undefined}
      className={classNames(styles['card'], highlighted && styles['highlighted'])}
      data-slot-id={slot.slotId}
      data-state={unreadable ? 'unreadable' : 'ready'}
    >
      <div className={styles['cardTop']}>
        <ImageSlot subject={slotImage(slot)} size="md" decorative />
        <div className={styles['cardInfo']}>
          <h2 id={headingId} className={styles['cardTitle']}>
            {slot.label}
          </h2>
          <p className={styles['cardPromotion']}>{slotPromotionName(slot)}</p>
          <dl className={styles['facts']}>
            <div className={styles['fact']}>
              <dt>Game date</dt>
              <dd>{formatGameDate(slot.header.gameDate)}</dd>
            </div>
            <div className={styles['fact']}>
              <dt>Last played</dt>
              <dd>
                <time dateTime={slot.updatedAt}>{formatRelativeTime(slot.updatedAt, now)}</time>
              </dd>
            </div>
            <div className={styles['fact']}>
              <dt>Size</dt>
              <dd>{formatSaveSize(slot.sizes.current)}</dd>
            </div>
          </dl>
          {needsUpgrade && !unreadable && (
            <Badge tone="prestige" className={styles['cardBadge']}>
              Needs upgrade
            </Badge>
          )}
        </div>
      </div>

      {unreadable && (
        <p className={styles['unreadable']} role="note">
          This save can&apos;t be read ({LOAD_STAGE_LABELS[unreadableStage].toLowerCase()} failed).
          Export it to attach to a bug report, or delete it.
        </p>
      )}
      {loading && (
        <p className={styles['loadingText']} role="status">
          Loading…
        </p>
      )}

      <div className={styles['cardActions']}>
        {!unreadable && (
          <Button
            variant="primary"
            iconStart="play"
            className={styles['loadButton']}
            loading={loading}
            disabled={loadDisabled}
            onClick={onLoad}
          >
            Load<VisuallyHidden> {slot.label}</VisuallyHidden>
          </Button>
        )}
        <div className={styles['secondaryActions']}>
          <Button size="sm" iconStart="download" loading={exporting} onClick={onExport}>
            Export<VisuallyHidden> {slot.label}</VisuallyHidden>
          </Button>
          {!unreadable && (
            <Button
              size="sm"
              iconStart="history"
              disabled={slot.backups.length === 0}
              onClick={onBackups}
            >
              Backups<VisuallyHidden> of {slot.label}</VisuallyHidden>
            </Button>
          )}
          <Button size="sm" variant="ghost" iconStart="trash" onClick={onDelete}>
            Delete<VisuallyHidden> {slot.label}</VisuallyHidden>
          </Button>
        </div>
      </div>
    </article>
  );
});
