/**
 * MTCH2's Finish section in the segment editor (EVT2-07): how a match ends, from `match.finishes`
 * for the draft's match type, the sides built, its stipulations and the planned result's kind (a
 * draw only offers draw finishes). It reuses the Match lab's `FinishSelectView` and patches the
 * draft's `match.finishKey`, so it saves with the segment through `booking.updateSegment`.
 *
 * Picking a finish keeps the planned way of winning when the finish ends with it and otherwise
 * switches to the finish's first way (one that can move a title when a title is on the line).
 * When a later change leaves the finish out (another type, a draw, a way of winning the finish
 * does not end with), it goes back to Auto and says so. On a Random winners show it only says
 * "Decided on the night". Design: docs/design/booking.md#integration.
 */
import { useEffect, useState } from 'react';
import type {
  ContentKey,
  FinishMethodOption,
  FinishOption,
  FinishesArgs,
  MatchDraft,
  MatchOutcome,
  SegmentDraft,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { FinishSelectView } from '@/screens/match-lab/result/FinishSelect';
import { FINISH_RESET_MESSAGE } from '@/screens/match-lab/result/resultText';
import { registerSegmentEditorSection } from '../registries/segmentEditorSections';
import type {
  SegmentDraftPatch,
  SegmentEditorSectionContext,
} from '../registries/segmentEditorSections';
import styles from '../editor/SegmentEditor.module.css';

export const FINISH_SECTION_ID = 'match.finish';

/** What the section says on a Random winners show. */
export const RANDOM_WINNERS_FINISH_TEXT = 'Decided on the night';

/** Said when the planned way of winning is one the booked finish does not end with. */
export const FINISH_METHOD_RESET_MESSAGE =
  "Finish reset to Auto: it doesn't end with that way of winning";

/** The sides with someone wrestling on them. */
export function builtSideCount(draft: MatchDraft): number {
  return new Set(
    draft.participants
      .filter((person) => person.role === 'competitor')
      .map((person) => person.side),
  ).size;
}

/** `match.finishes` for a match draft: its type, built sides, stipulations and result kind. */
export function finishesArgsForDraft(draft: MatchDraft): FinishesArgs {
  const sideCount = builtSideCount(draft);
  return {
    matchTypeKey: draft.match.matchTypeKey,
    ...(sideCount >= 2 ? { sideCount } : {}),
    ...(draft.match.stipulationKeys.length > 0
      ? { stipulationKeys: [...draft.match.stipulationKeys] }
      : {}),
    ...(draft.outcome === null ? {} : { outcomeKind: draft.outcome.kind }),
  };
}

/** The way of winning a finish is picked with: the plan's when the finish ends with it. */
function methodFor(
  finish: FinishOption,
  outcome: Extract<MatchOutcome, { kind: 'win' }>,
  titlesOnTheLine: boolean,
): FinishMethodOption | undefined {
  const kept = finish.methods.find((method) => method.key === outcome.methodKey);
  if (kept !== undefined) return kept;
  return titlesOnTheLine
    ? (finish.methods.find((method) => method.changesTitles) ?? finish.methods[0])
    : finish.methods[0];
}

/**
 * The patch for picking `finishKey` (null for Auto): the finish, and a way of winning it ends
 * with when the plan is a win by some other way.
 */
export function finishPatch(
  draft: MatchDraft,
  finishKey: ContentKey | null,
  finishes: readonly FinishOption[],
): SegmentDraftPatch {
  const finish = finishes.find((option) => option.key === finishKey);
  const { outcome } = draft;
  if (finish === undefined || outcome?.kind !== 'win') {
    return { match: { finishKey } };
  }
  const method = methodFor(finish, outcome, draft.match.titleIds.length > 0);
  return method === undefined || method.key === outcome.methodKey
    ? { match: { finishKey } }
    : { match: { finishKey }, outcome: { ...outcome, methodKey: method.key } };
}

/**
 * Why the booked finish no longer fits the draft, or null when it does (or none is booked).
 * Only asked once the list for the draft as it is now has loaded.
 */
export function finishMisfit(draft: MatchDraft, finishes: readonly FinishOption[]): string | null {
  const { finishKey } = draft.match;
  if (finishKey === null) return null;
  const finish = finishes.find((option) => option.key === finishKey);
  if (finish === undefined) return FINISH_RESET_MESSAGE;
  const { outcome } = draft;
  if (outcome?.kind === 'win' && !finish.methods.some((method) => method.key === outcome.methodKey))
    return FINISH_METHOD_RESET_MESSAGE;
  return null;
}

export interface BookingFinishFieldProps {
  readonly draft: SegmentDraft;
  readonly patch: (partial: SegmentDraftPatch) => void;
  readonly disabled: boolean;
  readonly randomWinners: boolean;
}

/** The Finish select for a match draft, or the Random winners line. */
export function BookingFinishField({
  draft,
  patch,
  disabled,
  randomWinners,
}: BookingFinishFieldProps) {
  const match = draft.kind === 'match' ? draft : null;
  const query = useEngineQuery(
    'match.finishes',
    match === null ? { matchTypeKey: draftTypeKeyFallback(draft) } : finishesArgsForDraft(match),
    { enabled: match !== null && !randomWinners },
  );
  const [notice, setNotice] = useState<string | null>(null);
  const finishes = query.data ?? null;
  const settled = finishes !== null && !query.isStale;
  const misfit = match !== null && settled ? finishMisfit(match, finishes) : null;
  const finishKey = match?.match.finishKey ?? null;

  useEffect(() => {
    if (misfit === null) return;
    patch({ match: { finishKey: null } });
    setNotice(misfit);
  }, [misfit, patch]);

  useEffect(() => {
    // A new booked finish clears an old reset message.
    if (finishKey !== null) setNotice(null);
  }, [finishKey]);

  if (match === null) return null;
  if (randomWinners) return <p className={styles['hint']}>{RANDOM_WINNERS_FINISH_TEXT}</p>;
  if (query.error !== null && query.error.kind === 'rejected') {
    return (
      <p className={styles['hint']} role="status">
        {query.error.reasons.map((reason) => reason.message).join(' ')}
      </p>
    );
  }
  return (
    <FinishSelectView
      finishes={finishes}
      value={finishKey}
      notice={notice}
      disabled={disabled}
      onValueChange={(picked) => {
        patch(finishPatch(match, picked, finishes ?? []));
      }}
    />
  );
}

/** A type key for the disabled query when the draft is a talking segment (never asked). */
function draftTypeKeyFallback(draft: SegmentDraft): ContentKey {
  return draft.kind === 'match' ? draft.match.matchTypeKey : draft.angle.angleTypeKey;
}

/** The section as the registry draws it. */
export function BookingFinishSection(context: SegmentEditorSectionContext) {
  return (
    <BookingFinishField
      draft={context.draft}
      patch={context.patch}
      disabled={context.disabled}
      randomWinners={context.randomWinners}
    />
  );
}

registerSegmentEditorSection({
  id: FINISH_SECTION_ID,
  title: 'Finish',
  order: 10,
  appliesTo: 'match',
  render: (context) => <BookingFinishSection {...context} />,
});
