/**
 * CRTV4's Storyline section in the segment editor (CRTV4-04): which storylines the segment counts
 * for, from `storylines.linkOptions`. Unlike the other sections it does not wait for Save: a link,
 * an unlink or a finale is written straight away with `storylines.linkSegment` (the whole new
 * list) or `storylines.setFinale`, and the new list is patched into the draft so the sheet's Save
 * writes the same links back. A new segment has no id yet, so the section asks for a Save first.
 *
 * Refusals are shown in place, word for word. Moving a finale from another segment asks first.
 * Design: docs/design/storylines.md#linking.
 */
import { useState } from 'react';
import type { Reason, SegmentId, StorylineId } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DEFAULT_HOT_FROM, StorylineLinkPicker } from '@/components/StorylineLinkPicker';
import type { LinkedStorylineView } from '@/components/StorylineLinkPicker';
import type { SegmentEditorSectionContext } from '../registries/segmentEditorSections';
import styles from '../editor/SegmentEditor.module.css';

export const STORYLINE_SECTION_ID = 'storylines';

/** What a new segment's section says: links need the segment's id. */
export const SAVE_FIRST_TEXT = 'Save the segment first to link a storyline';

/** Shown above the read-only list once the card can no longer change. */
export const LINKS_LOCKED_TEXT = "This show's card can no longer change, so its links are fixed.";

const NO_REASON = 'The game did not say why.';

/** "Move the finale of 'Ashfall Rivalry' here from Test Weekly, Slot 3?" */
export function moveFinaleTitle(row: LinkedStorylineView): string {
  const from = row.finaleElsewhere;
  return from === null
    ? `Make this the finale of '${row.name}'?`
    : `Move the finale of '${row.name}' here from ${from.showName}, ${from.slot}?`;
}

interface LinksProps {
  readonly segmentId: SegmentId;
  readonly context: SegmentEditorSectionContext;
}

function StorylineLinks({ segmentId, context }: LinksProps) {
  const options = useEngineQuery('storylines.linkOptions', { segmentId });
  const list = useEngineQuery('storylines.list', { status: 'active' });
  const linkSegment = useEngineCommand('storylines.linkSegment');
  const setFinale = useEngineCommand('storylines.setFinale');
  const [refusal, setRefusal] = useState<readonly Reason[]>([]);
  const [moving, setMoving] = useState<LinkedStorylineView | null>(null);

  const data = options.data;
  if (data === undefined) {
    if (options.status === 'error') {
      const error = options.error;
      const message =
        error === null
          ? NO_REASON
          : error.kind === 'transport'
            ? error.message
            : (error.reasons[0]?.message ?? NO_REASON);
      return <p className={styles['hint']}>{message}</p>;
    }
    return (
      <p className={styles['hint']} role="status">
        Loading…
      </p>
    );
  }
  if (data.kind === 'unavailable') {
    return <p className={styles['hint']}>{data.reason.message}</p>;
  }

  const refused = (reasons: readonly Reason[]): void => {
    setRefusal(reasons.length > 0 ? reasons : [{ code: 'unknown', message: NO_REASON }]);
  };

  const writeLinks = async (storylineIds: readonly StorylineId[]): Promise<void> => {
    const result = await linkSegment.run({ segmentId, storylineIds: [...storylineIds] });
    if (!result.ok) {
      refused(result.reasons);
      return;
    }
    setRefusal([]);
    // Keep the draft in step, so the sheet's Save writes the same links back.
    context.patch({ storylineIds: result.data.storylineIds });
  };

  const writeFinale = async (storylineId: StorylineId, on: boolean): Promise<void> => {
    const result = await setFinale.run({ storylineId, segmentId: on ? segmentId : null });
    if (!result.ok) {
      refused(result.reasons);
      return;
    }
    setRefusal([]);
  };

  const linkedIds = data.linked.map((row) => row.storylineId);
  const pending = linkSegment.pending || setFinale.pending || context.disabled;

  return (
    <>
      <StorylineLinkPicker
        linked={data.linked}
        suggestions={data.suggestions}
        others={data.others}
        maxLinks={data.maxLinks}
        canSetFinale={data.canSetFinale}
        disabledReason={data.locked ? LINKS_LOCKED_TEXT : null}
        pending={pending}
        hotFrom={list.data?.hotFrom ?? DEFAULT_HOT_FROM}
        onLink={(storylineId) => {
          void writeLinks([...linkedIds, storylineId]);
        }}
        onUnlink={(storylineId) => {
          void writeLinks(linkedIds.filter((id) => id !== storylineId));
        }}
        onSetFinale={(storylineId, on) => {
          const row = data.linked.find((candidate) => candidate.storylineId === storylineId);
          if (on && row?.finaleElsewhere !== null && row !== undefined) {
            setMoving(row);
            return;
          }
          void writeFinale(storylineId, on);
        }}
      />
      {refusal.length > 0 && (
        <div className={styles['refusal']} role="alert">
          <ul className={styles['refusalList']}>
            {refusal.map((reason, index) => (
              <li key={`${reason.code}-${String(index)}`}>{reason.message}</li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog
        open={moving !== null}
        onClose={() => {
          setMoving(null);
        }}
        onConfirm={async () => {
          if (moving === null) return;
          await writeFinale(moving.storylineId, true);
          setMoving(null);
        }}
        title={moving === null ? '' : moveFinaleTitle(moving)}
        body="A storyline has one finale. The other segment stays linked but is no longer its finale."
        confirmLabel="Move finale"
      />
    </>
  );
}

/** The section's body: the links of a saved segment, or a note asking for a Save first. */
export function StorylineEditorSection({
  context,
}: {
  readonly context: SegmentEditorSectionContext;
}) {
  const segmentId = context.slot.segment?.segmentId;
  if (segmentId === undefined) {
    return <p className={styles['hint']}>{SAVE_FIRST_TEXT}</p>;
  }
  return <StorylineLinks key={segmentId} segmentId={segmentId} context={context} />;
}
