import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { isId, MAX_STORYLINE_MEMBERS, traceRefFromKey } from '@ringside/engine';
import type {
  Reason,
  StorylineDetail,
  StorylineId,
  StorylineMemberView,
  StorylineSide,
  StorylineTimelineEntry,
} from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes, STORYLINE_ROUTE_PARAM } from '@/app/routes';
import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DropdownMenu } from '@/components/DropdownMenu';
import type { DropdownMenuEntry } from '@/components/DropdownMenu';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate } from '@/components/format';
import { Icon } from '@/components/Icon';
import { ImageSlot } from '@/components/ImageSlot';
import { Panel } from '@/components/Panel';
import { SegmentedMeter } from '@/components/SegmentedMeter';
import { Sheet } from '@/components/Sheet';
import { StarRating } from '@/components/StarRating';
import { HOT_LABEL, LEFT_PROMOTION_TEXT } from '@/components/StorylineCard';
import { STORYLINE_SIDE_LABELS, StorylineSideChip } from '@/components/StorylineSideChip';
import { Explained, WhyButton } from '@/components/Trace';
import { MemberPicker } from './MemberPicker';
import type { ChosenMember } from './MemberPicker';
import { StorylineEditorSheet } from './StorylineEditorSheet';
import { storylineWarningsFrom } from './storylineWarnings';
import {
  coolingText,
  EMPTY_TIMELINE_TEXT,
  endingTitle,
  isNoWorldError,
  NO_GAME_TEXT,
  NO_GAME_TITLE,
  queryErrorText,
  reasonsText,
} from './storylineText';
import styles from './StorylineDetailScreen.module.css';

export const STORYLINE_NOT_FOUND_TITLE = 'Storyline not found';
const SCREEN_TITLE = 'Storyline';

const SIDE_GROUPS: readonly { readonly side: StorylineSide; readonly title: string }[] = [
  { side: 'face', title: 'Faces' },
  { side: 'heel', title: 'Heels' },
  { side: 'neutral', title: 'Neutral' },
];

function BackToStorylines() {
  return (
    <Link to={routes.game.storylines()} className={styles['backLink']}>
      <Icon name="back" size="sm" decorative />
      Back to Storylines
    </Link>
  );
}

interface MessagePageProps {
  readonly title: string;
  readonly message: string;
  readonly body: ReactNode;
}

/** A page with nothing to show but a heading and why: an unknown storyline, or no game. */
function MessagePage({ title, message, body }: MessagePageProps) {
  useDocumentTitle(title);
  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['heading']}>{title}</RouteHeading>
      <EmptyState size="page" icon="storylines" title={message} body={body} headingLevel={2} />
    </div>
  );
}

function StorylineNotFound({ reason }: { readonly reason: string }) {
  return (
    <MessagePage
      title={STORYLINE_NOT_FOUND_TITLE}
      message="There is no storyline to show"
      body={
        <>
          {reason} <Link to={routes.game.storylines()}>Back to Storylines</Link>
        </>
      }
    />
  );
}

/** "Started Jan 4, 2027 · Ended Mar 1, 2027". */
function datesText(storyline: StorylineDetail): string {
  const started = `Started ${formatGameDate(storyline.startedOn)}`;
  return storyline.endedOn === null
    ? started
    : `${started} · Ended ${formatGameDate(storyline.endedOn)}`;
}

/** "Pre-show" or "Segment 3" (slots count from 0 in the engine). */
export function timelineSlotText(entry: StorylineTimelineEntry): string {
  return entry.preShow ? 'Pre-show' : `Segment ${String(entry.slot + 1)}`;
}

function TimelineItem({ entry }: { readonly entry: StorylineTimelineEntry }) {
  const ratingRef = entry.ratingTraceId === null ? null : traceRefFromKey(entry.ratingTraceId);
  return (
    <li className={styles['timelineItem']}>
      <p className={styles['timelineMeta']}>
        {formatGameDate(entry.date)} · {entry.eventName} · {timelineSlotText(entry)}
      </p>
      <p className={styles['timelineLabel']}>
        {entry.label}
        {entry.isFinale && (
          <Badge tone="prestige" variant="solid">
            Finale
          </Badge>
        )}
      </p>
      {entry.stars !== null && (
        <p className={styles['timelineStars']}>
          <StarRating value={entry.stars} size="sm" />
          {ratingRef !== null && (
            <WhyButton
              label="Stars"
              value={entry.stars}
              source={{ traceRef: ratingRef }}
              buttonLabel={`Why ${entry.label} got ${String(entry.stars)} stars`}
            />
          )}
        </p>
      )}
    </li>
  );
}

function HeatPanel({
  storyline,
  hotFrom,
}: {
  readonly storyline: StorylineDetail;
  readonly hotFrom: number;
}) {
  if (storyline.heat === null) return null;
  return (
    <Panel title="Heat">
      <div className={styles['heatBody']}>
        <div className={styles['heatRow']}>
          <SegmentedMeter
            label="Heat"
            value={storyline.heat}
            dangerFrom={hotFrom}
            dangerLabel={HOT_LABEL}
            showValue={false}
            hideLabel
            className={styles['meter']}
          />
          <Explained value={storyline.heat} label="Heat" traceRef={storyline.heatTraceRef} />
          {storyline.heat >= hotFrom && (
            <Badge tone="action" variant="solid">
              {HOT_LABEL}
            </Badge>
          )}
        </div>
        {storyline.cooling !== null && (
          <p className={styles['muted']}>{coolingText(storyline.cooling)}</p>
        )}
        {storyline.startedBecauseTraceRef !== null && (
          <p className={styles['whyLine']}>
            Why it started
            <WhyButton
              label="Why it started"
              value={storyline.name}
              source={{ traceRef: storyline.startedBecauseTraceRef }}
              buttonLabel="Why did this storyline start?"
            />
          </p>
        )}
      </div>
    </Panel>
  );
}

function EndingPanel({ storyline }: { readonly storyline: StorylineDetail }) {
  const { ending } = storyline;
  if (ending === null) return null;
  return (
    <Panel title="Ending">
      <div className={styles['endingBody']}>
        <p className={styles['endingTitle']}>
          {endingTitle(ending)}
          {ending.payoff === 'paid' && ending.payoffTraceRef !== null && (
            <WhyButton
              label="Payoff"
              value={ending.linkedSegments}
              source={{ traceRef: ending.payoffTraceRef }}
              buttonLabel="Why this payoff?"
            />
          )}
        </p>
        <p className={styles['muted']}>
          Ended {formatGameDate(ending.endedOn)} with {String(ending.linkedSegments)} linked{' '}
          {ending.linkedSegments === 1 ? 'segment' : 'segments'}.
        </p>
      </div>
    </Panel>
  );
}

interface MemberRowProps {
  readonly member: StorylineMemberView;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly onSetSide: (member: StorylineMemberView, side: StorylineSide) => void;
  readonly onRemove: (member: StorylineMemberView) => void;
}

function MemberRow({ member, editable, busy, onSetSide, onRemove }: MemberRowProps) {
  const items: DropdownMenuEntry[] = [
    {
      kind: 'submenu',
      id: 'side',
      label: 'Change side',
      items: SIDE_GROUPS.map(({ side }) => ({
        kind: 'item',
        id: side,
        label: STORYLINE_SIDE_LABELS[side],
        disabled: side === member.side,
        onSelect: () => {
          onSetSide(member, side);
        },
      })),
    },
    { kind: 'separator', id: 'separator' },
    {
      kind: 'item',
      id: 'remove',
      label: 'Remove',
      tone: 'danger',
      onSelect: () => {
        onRemove(member);
      },
    },
  ];
  return (
    <li className={styles['member']}>
      <ImageSlot
        subject={{
          kind: 'person',
          id: member.personId,
          name: member.name,
          ...(member.imageRef === null ? {} : { imageRef: member.imageRef }),
        }}
        size="sm"
        decorative
      />
      {/* Plain text until the worker profile route is on main (CRTV3-05 links it). */}
      <span className={styles['memberName']} title={member.name}>
        {member.name}
      </span>
      <span className={styles['memberChips']}>
        <StorylineSideChip side={member.side} />
        {!member.stillEmployed && <Badge tone="negative">{LEFT_PROMOTION_TEXT}</Badge>}
      </span>
      {editable && (
        <DropdownMenu
          trigger={
            <IconButton
              icon="more"
              size="sm"
              variant="ghost"
              label={`Actions for ${member.name}`}
              disabled={busy}
              className={styles['memberMenu']}
            />
          }
          items={items}
        />
      )}
    </li>
  );
}

interface AddMembersSheetProps {
  readonly storyline: StorylineDetail;
  readonly open: boolean;
  readonly onClose: () => void;
}

/** Add member: the member picker in a small sheet; each pick is added with its side. */
function AddMembersSheet({ storyline, open, onClose }: AddMembersSheetProps) {
  const [chosen, setChosen] = useState<readonly ChosenMember[]>([]);
  const [reasons, setReasons] = useState<readonly Reason[]>([]);
  const add = useEngineCommand('storylines.addMember');
  const options = useEngineQuery(
    'storylines.memberOptions',
    { promotionId: storyline.promotionId },
    { enabled: open },
  );
  const members = [...storyline.faces, ...storyline.heels, ...storyline.neutrals];

  const close = (): void => {
    setChosen([]);
    setReasons([]);
    onClose();
  };
  const save = async (): Promise<void> => {
    let remaining = chosen;
    for (const member of chosen) {
      const result = await add.run({
        storylineId: storyline.id,
        personId: member.personId,
        side: member.side,
      });
      if (!result.ok) {
        setChosen(remaining);
        setReasons(result.reasons);
        return;
      }
      remaining = remaining.filter((other) => other.personId !== member.personId);
    }
    close();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Add people"
      size="sm"
      footer={
        <div className={styles['sheetFooter']}>
          <Button variant="secondary" onClick={close} disabled={add.pending}>
            Cancel
          </Button>
          <Button
            loading={add.pending}
            disabled={chosen.length === 0}
            onClick={() => {
              void save();
            }}
          >
            Add
          </Button>
        </div>
      }
    >
      <MemberPicker
        options={options.data?.options ?? null}
        chosen={chosen}
        onChange={setChosen}
        alreadyIn={members.map((member) => member.personId)}
        max={Math.max(0, MAX_STORYLINE_MEMBERS - members.length)}
        error={reasons.length === 0 ? undefined : reasonsText(reasons)}
        disabled={add.pending}
      />
    </Sheet>
  );
}

function MembersPanel({ storyline }: { readonly storyline: StorylineDetail }) {
  const setSide = useEngineCommand('storylines.setSide');
  const remove = useEngineCommand('storylines.removeMember');
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<StorylineMemberView | null>(null);
  const [adding, setAdding] = useState(false);
  const { editable } = storyline;
  const groups = { face: storyline.faces, heel: storyline.heels, neutral: storyline.neutrals };

  const changeSide = async (member: StorylineMemberView, side: StorylineSide): Promise<void> => {
    const result = await setSide.run({
      storylineId: storyline.id,
      personId: member.personId,
      side,
    });
    setProblem(result.ok ? null : reasonsText(result.reasons));
  };
  const confirmRemove = async (): Promise<void> => {
    if (removing === null) return;
    const result = await remove.run({ storylineId: storyline.id, personId: removing.personId });
    if (!result.ok) throw new Error(reasonsText(result.reasons));
  };

  return (
    <Panel
      title="People"
      actions={
        editable ? (
          <Button
            variant="secondary"
            size="sm"
            iconStart="add"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add member
          </Button>
        ) : undefined
      }
    >
      <div className={styles['groups']}>
        {problem !== null && (
          <p role="alert" className={styles['problem']}>
            {problem}
          </p>
        )}
        {SIDE_GROUPS.map(({ side, title }) => {
          const members = groups[side];
          if (side === 'neutral' && members.length === 0) return null;
          return (
            <section key={side} className={styles['group']} aria-label={title}>
              <h3 className={styles['groupHeading']}>{title}</h3>
              {members.length === 0 ? (
                <p className={styles['muted']}>No one yet</p>
              ) : (
                <ul className={styles['memberList']}>
                  {members.map((member) => (
                    <MemberRow
                      key={member.personId}
                      member={member}
                      editable={editable}
                      busy={setSide.pending || remove.pending}
                      onSetSide={(target, nextSide) => {
                        void changeSide(target, nextSide);
                      }}
                      onRemove={setRemoving}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {editable && (
        <>
          <ConfirmDialog
            open={removing !== null}
            onClose={() => {
              setRemoving(null);
            }}
            onConfirm={confirmRemove}
            title={`Remove ${removing?.name ?? 'this person'}?`}
            body={`${removing?.name ?? 'They'} will no longer be part of ${storyline.name}. Their alignment doesn't change.`}
            confirmLabel="Remove"
          />
          <AddMembersSheet
            storyline={storyline}
            open={adding}
            onClose={() => {
              setAdding(false);
            }}
          />
        </>
      )}
    </Panel>
  );
}

function EndStorylineDialog({
  storyline,
  open,
  onClose,
}: {
  readonly storyline: StorylineDetail;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const end = useEngineCommand('storylines.end');
  const preview = useEngineQuery(
    'storylines.endPreview',
    { storylineId: storyline.id },
    { enabled: open, keepPreviousData: false },
  );
  let body: string;
  if (preview.status === 'loading') {
    body = 'Working out what ending it now would pay…';
  } else if (preview.data === undefined) {
    body = queryErrorText(preview.error);
  } else {
    body = preview.data.message;
  }
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={async () => {
        const result = await end.run({ storylineId: storyline.id });
        if (!result.ok) throw new Error(reasonsText(result.reasons));
      }}
      title={`End ${storyline.name}?`}
      body={body}
      confirmLabel="End storyline"
      tone="danger"
      confirmDisabled={preview.data === undefined}
    />
  );
}

function WarningsNotice({ warnings }: { readonly warnings: readonly string[] }) {
  const [dismissed, setDismissed] = useState(false);
  if (warnings.length === 0 || dismissed) return null;
  return (
    <div role="status" className={styles['notice']}>
      <Icon name="warning" decorative />
      <div className={styles['noticeText']}>
        {warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </div>
      <IconButton
        icon="close"
        size="sm"
        variant="ghost"
        label="Dismiss"
        onClick={() => {
          setDismissed(true);
        }}
      />
    </div>
  );
}

function LoadedStoryline({ storylineId }: { readonly storylineId: StorylineId }) {
  const location = useLocation();
  const query = useEngineQuery('storylines.detail', { storylineId });
  // The hot threshold comes with the list; the page reads it from there.
  const list = useEngineQuery(
    'storylines.list',
    query.data === undefined ? {} : { promotionId: query.data.promotionId, status: 'active' },
    { enabled: query.data !== undefined },
  );
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState(false);
  useDocumentTitle(query.data?.name ?? null);

  if (query.status === 'loading') {
    return (
      <div className={styles['screen']} aria-busy="true">
        <BackToStorylines />
        <RouteHeading className={styles['heading']}>{SCREEN_TITLE}</RouteHeading>
        <p className={styles['muted']}>Loading the storyline…</p>
      </div>
    );
  }
  if (query.status === 'error' || query.data === undefined) {
    if (isNoWorldError(query.error)) {
      return <MessagePage title={SCREEN_TITLE} message={NO_GAME_TITLE} body={NO_GAME_TEXT} />;
    }
    return <StorylineNotFound reason={queryErrorText(query.error)} />;
  }

  const storyline = query.data;
  const own = storyline.heat !== null;
  const hotFrom = list.data?.hotFrom ?? 70;
  return (
    <div className={styles['screen']}>
      <BackToStorylines />
      <WarningsNotice warnings={storylineWarningsFrom(location.state)} />
      <header className={styles['header']}>
        <RouteHeading className={styles['heading']}>{storyline.name}</RouteHeading>
        <div className={styles['chips']}>
          <Badge tone={storyline.status === 'active' ? 'positive' : 'neutral'}>
            {storyline.status === 'active' ? 'Active' : 'Ended'}
          </Badge>
          {storyline.brandName !== null && <Badge tone="data">{storyline.brandName}</Badge>}
          {!own && <Badge>{storyline.promotionName}</Badge>}
        </div>
        <p className={styles['dates']}>{datesText(storyline)}</p>
        {storyline.editable && (
          <div className={styles['actions']}>
            <Button
              variant="secondary"
              iconStart="edit"
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setEnding(true);
              }}
            >
              End storyline
            </Button>
          </div>
        )}
      </header>
      <div className={styles['layout']}>
        <div className={styles['main']}>
          <EndingPanel storyline={storyline} />
          <MembersPanel storyline={storyline} />
          {own && (
            <Panel title="Summary">
              <p className={styles['summary']}>
                {storyline.summary === '' ? 'No summary yet.' : storyline.summary}
              </p>
            </Panel>
          )}
          {own && (
            <Panel title="Timeline">
              {storyline.timeline.length === 0 ? (
                <p className={styles['muted']}>{EMPTY_TIMELINE_TEXT}</p>
              ) : (
                <ol className={styles['timeline']}>
                  {storyline.timeline.map((entry) => (
                    <TimelineItem key={entry.segmentId} entry={entry} />
                  ))}
                </ol>
              )}
            </Panel>
          )}
        </div>
        <div className={styles['aside']}>
          {own ? (
            <HeatPanel storyline={storyline} hotFrom={hotFrom} />
          ) : (
            <Panel title="Heat">
              <p className={styles['muted']}>
                Heat not public: only {storyline.promotionName} knows how hot this is.
              </p>
            </Panel>
          )}
        </div>
      </div>
      {storyline.editable && (
        <>
          <StorylineEditorSheet
            mode="edit"
            storyline={storyline}
            open={editing}
            onClose={() => {
              setEditing(false);
            }}
          />
          <EndStorylineDialog
            storyline={storyline}
            open={ending}
            onClose={() => {
              setEnding(false);
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * One storyline at `/game/storylines/:storylineId`: its status and dates, the people by side, the
 * heat with how it cools, the summary and the linked segments. Your own active storyline can be
 * edited, gain and lose people, change sides and end; an ended or rival one is read-only, and a
 * rival's shows only its public facts. An unknown storyline shows "Storyline not found".
 */
export function StorylineDetailScreen() {
  const params = useParams();
  const storylineId = params[STORYLINE_ROUTE_PARAM];
  if (!isId('storyline', storylineId)) {
    return <StorylineNotFound reason="That address is not a storyline's." />;
  }
  return <LoadedStoryline key={storylineId} storylineId={storylineId} />;
}
