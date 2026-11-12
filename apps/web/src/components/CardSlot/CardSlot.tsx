import { forwardRef, Fragment, useId } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button } from '../Button';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import { ImageSlot } from '../ImageSlot';
import type { ImageSubject } from '../ImageSlot';
import { SlashDivider } from '../SlashDivider';
import styles from './CardSlot.module.css';

/** Where a slot sits on the card. The role comes from the slot's position (design decision D-10). */
export type CardSlotRole = 'pre-show' | 'opener' | 'midcard' | 'semi-main' | 'main-event';

export const CARD_SLOT_ROLE_LABELS: Readonly<Record<CardSlotRole, string>> = {
  'pre-show': 'Pre-show',
  opener: 'Opener',
  midcard: 'Midcard',
  'semi-main': 'Semi-Main',
  'main-event': 'Main Event',
};

/** What a chip on the slot describes. Each kind has its own colour. */
export type CardSlotChipKind = 'match-type' | 'title' | 'storyline';

export interface CardSlotChip {
  /** Stable key for the list. */
  readonly id: string;
  readonly kind: CardSlotChipKind;
  readonly label: string;
}

/** One side of the segment: a wrestler, a team, or the people in a promo. */
export interface CardSlotSide {
  /** The side's name as shown, such as "Kai Moreno & Vance Troy". */
  readonly name: string;
  /** The people on this side, drawn as avatars. Their names are in `name`, so these are decorative. */
  readonly members: readonly ImageSubject[];
  /** A short tag above the name, such as "Face" or "Champions". */
  readonly label?: string;
  /** A line under the name, such as momentum or a reign length. */
  readonly detail?: ReactNode;
}

const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export type CardSlotSideKey = 'a' | 'b';

/** How many problems the booking checks found on a slot. Shown as an icon and words. */
export interface CardSlotIssues {
  readonly errors: number;
  readonly warnings: number;
}

/** "2 problems", "1 warning", "1 problem, 2 warnings". Empty when there are none. */
export function cardSlotIssuesText({ errors, warnings }: CardSlotIssues): string {
  const parts: string[] = [];
  if (errors > 0) parts.push(`${String(errors)} ${errors === 1 ? 'problem' : 'problems'}`);
  if (warnings > 0) parts.push(`${String(warnings)} ${warnings === 1 ? 'warning' : 'warnings'}`);
  return parts.join(', ');
}

const SIDE_KEYS = 'abcdefghijklmnopqrstuvwxyz';

/** `a`, `b`, `c` … for the side at `index`, as drawn in `data-side`. */
function sideKeyOf(index: number): string {
  return SIDE_KEYS[index] ?? String(index + 1);
}
export type CardSlotAccent = 'data' | 'prestige' | 'action';

export interface CardSlotProps {
  /** Where the slot sits on the card. Named `slotRole` because `role` is the ARIA attribute. */
  readonly slotRole: CardSlotRole;
  /** The slot's number on the card, shown before the role. */
  readonly slotNumber?: number;
  /** Overrides the role's label. */
  readonly roleLabel?: string;
  /** Heading level of the slot title. 3 by default. */
  readonly headingLevel?: 2 | 3 | 4;
  /** Match type, title on the line, storyline. */
  readonly chips?: readonly CardSlotChip[];
  /** The first side. Without it the slot is empty and shows the add actions. */
  readonly sideA?: CardSlotSide;
  /** The second side. Without it (and with `sideA`) the segment is one side, such as a promo. */
  readonly sideB?: CardSlotSide;
  /**
   * Every side, in order, for a match with any number of sides (a triple threat, a four-way).
   * Takes the place of `sideA` / `sideB`; "vs" is drawn between each pair.
   */
  readonly sides?: readonly CardSlotSide[];
  /** The side the booker picked to win. */
  readonly winner?: CardSlotSideKey;
  /** The winning side's index in `sides` (or 0 / 1 for side A / B). Takes the place of `winner`. */
  readonly winnerIndex?: number;
  /** A result that has no winner, such as "Draw" or "No contest", shown under the matchup. */
  readonly resultLabel?: string;
  /** The booking problems on this slot, as an icon and words in the header. Hidden at 0 and 0. */
  readonly issues?: CardSlotIssues;
  /** Drawn right after the role tag, such as a Why? button for the role and a duration chip. */
  readonly roleAside?: ReactNode;
  /** Text of the winner marker. "Winner" by default. */
  readonly winnerLabel?: string;
  /**
   * The colour bar down the left edge. By default the main event is red-orange, a slot with a
   * title chip is gold, and the rest are cyan.
   */
  readonly accent?: CardSlotAccent;
  /** Slot for a drag handle, such as `CardSlotDragHandle` wired to a sorting library. */
  readonly dragHandle?: ReactNode;
  /** Controls at the end of the header, such as a "more" menu. */
  readonly actions?: ReactNode;
  /** Empty slot: called by the "Add match" button. The button shows only when this is given. */
  readonly onAddMatch?: () => void;
  /** Empty slot: called by the "Add promo" button. The button shows only when this is given. */
  readonly onAddPromo?: () => void;
  /** The text of the `onAddPromo` button. "Add promo" by default. */
  readonly addPromoLabel?: string;
  /** Empty slot heading. "Open slot" by default. */
  readonly emptyTitle?: string;
  /** Empty slot hint under the heading. */
  readonly emptyHint?: ReactNode;
  readonly className?: string | undefined;
}

/** The accent a slot gets when none is given. */
export function defaultCardSlotAccent(
  role: CardSlotRole,
  chips: readonly CardSlotChip[] = [],
): CardSlotAccent {
  if (role === 'main-event') return 'action';
  return chips.some((chip) => chip.kind === 'title') ? 'prestige' : 'data';
}

interface SideViewProps {
  readonly side: CardSlotSide;
  readonly sideKey: string;
  readonly isWinner: boolean;
  readonly winnerLabel: string;
}

function SideView({ side, sideKey, isWinner, winnerLabel }: SideViewProps) {
  return (
    <div
      className={classNames(styles['side'], isWinner && styles['winner'])}
      data-side={sideKey}
      data-winner={isWinner}
    >
      <span className={styles['avatars']}>
        {side.members.map((member) => (
          <ImageSlot key={member.id} subject={member} size="md" shape="square" decorative />
        ))}
      </span>
      <span className={styles['sideText']}>
        {(side.label !== undefined || isWinner) && (
          <span className={styles['sideTags']}>
            {side.label !== undefined && <span className={styles['sideLabel']}>{side.label}</span>}
            {isWinner && (
              <span className={styles['winnerMarker']} data-part="winner">
                <Icon name="check" decorative />
                {winnerLabel}
              </span>
            )}
          </span>
        )}
        <span className={styles['sideName']}>{side.name}</span>
        {side.detail !== undefined && <span className={styles['sideDetail']}>{side.detail}</span>}
      </span>
    </div>
  );
}

/**
 * A booking slot: its role on the card, the matchup (side A vs side B with avatars), chips for
 * match type, title and storyline, and the chosen winner. An empty slot shows "Add match" and
 * "Add promo" instead. It is an article named by its slot title, so a card of slots reads as a
 * list of segments. On phones the two sides stack.
 */
export function CardSlot({
  slotRole,
  slotNumber,
  roleLabel,
  headingLevel = 3,
  chips = [],
  sideA,
  sideB,
  sides,
  winner,
  winnerIndex,
  resultLabel,
  issues,
  roleAside,
  winnerLabel = 'Winner',
  accent,
  dragHandle,
  actions,
  onAddMatch,
  onAddPromo,
  addPromoLabel = 'Add promo',
  emptyTitle = 'Open slot',
  emptyHint,
  className,
}: CardSlotProps) {
  const headingId = useId();
  const Heading = HEADING_TAGS[headingLevel];
  const allSides: readonly CardSlotSide[] =
    sides ?? [sideA, sideB].filter((side): side is CardSlotSide => side !== undefined);
  const isEmpty = allSides.length === 0;
  const winningIndex = winnerIndex ?? (winner === 'a' ? 0 : winner === 'b' ? 1 : undefined);
  const issuesText = issues === undefined ? '' : cardSlotIssuesText(issues);
  const resolvedAccent = accent ?? defaultCardSlotAccent(slotRole, chips);
  const label = roleLabel ?? CARD_SLOT_ROLE_LABELS[slotRole];

  return (
    <article
      aria-labelledby={headingId}
      className={classNames(
        styles['slot'],
        styles[`accent-${resolvedAccent}`],
        isEmpty && styles['empty'],
        slotRole === 'pre-show' && styles['preShow'],
        className,
      )}
      data-role={slotRole}
      data-state={isEmpty ? 'empty' : 'booked'}
    >
      <div className={styles['header']}>
        {dragHandle !== undefined && <span className={styles['handle']}>{dragHandle}</span>}
        <Heading
          id={headingId}
          className={styles['roleTag']}
          // Spelled out so screen readers hear "Slot 3: Midcard" rather than the slashes.
          aria-label={slotNumber === undefined ? undefined : `Slot ${String(slotNumber)}: ${label}`}
        >
          {slotNumber !== undefined && (
            <>
              <span>Slot {slotNumber}</span>
              <SlashDivider variant="inline" tone="inherit" />
            </>
          )}
          <span>{label}</span>
        </Heading>
        {roleAside !== undefined && <span className={styles['roleAside']}>{roleAside}</span>}
        {chips.length > 0 && (
          <ul className={styles['chips']} aria-label="Segment details">
            {chips.map((chip) => (
              <li
                key={chip.id}
                className={classNames(styles['chip'], styles[`chip-${chip.kind}`])}
                data-kind={chip.kind}
              >
                {chip.kind === 'title' && <Icon name="titles" decorative />}
                {chip.label}
              </li>
            ))}
          </ul>
        )}
        {issues !== undefined && issuesText !== '' && (
          <span
            className={styles['issues']}
            data-severity={issues.errors > 0 ? 'error' : 'warning'}
            data-part="issues"
          >
            <Icon name={issues.errors > 0 ? 'error' : 'warning'} decorative />
            {issuesText}
          </span>
        )}
        {actions !== undefined && <span className={styles['actions']}>{actions}</span>}
      </div>

      {isEmpty ? (
        <div className={styles['emptyBody']}>
          <p className={styles['emptyTitle']}>{emptyTitle}</p>
          {emptyHint !== undefined && <p className={styles['emptyHint']}>{emptyHint}</p>}
          {(onAddMatch !== undefined || onAddPromo !== undefined) && (
            <div className={styles['emptyActions']}>
              {onAddMatch !== undefined && (
                <Button variant="primary" iconStart="add" onClick={onAddMatch}>
                  Add match
                </Button>
              )}
              {onAddPromo !== undefined && (
                <Button iconStart="add" onClick={onAddPromo}>
                  {addPromoLabel}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            className={classNames(
              styles['matchup'],
              allSides.length === 1 && styles['oneSide'],
              allSides.length > 2 && styles['multiSide'],
            )}
            data-sides={allSides.length}
          >
            {allSides.map((side, index) => (
              <Fragment key={sideKeyOf(index)}>
                {index > 0 && <span className={styles['versus']}>vs</span>}
                <SideView
                  side={side}
                  sideKey={sideKeyOf(index)}
                  isWinner={winningIndex === index}
                  winnerLabel={winnerLabel}
                />
              </Fragment>
            ))}
          </div>
          {resultLabel !== undefined && (
            <p className={styles['result']} data-part="result">
              {resultLabel}
            </p>
          )}
        </>
      )}
    </article>
  );
}

type ManagedHandleAttribute = 'style' | 'aria-label' | 'children';

export interface CardSlotDragHandleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  ManagedHandleAttribute
> {
  /** What dragging does, such as "Move slot 3". Required: the handle is an icon only. */
  readonly label: string;
}

/**
 * The grip a sorting library hooks into, for `CardSlot`'s `dragHandle` slot. A real button, so it
 * can be focused and moved from the keyboard; it forwards its ref and passes every other
 * attribute and listener through.
 */
export const CardSlotDragHandle = forwardRef<HTMLButtonElement, CardSlotDragHandleProps>(
  function CardSlotDragHandle({ label, type = 'button', className, ...buttonAttributes }, ref) {
    return (
      <button
        {...buttonAttributes}
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={classNames(styles['dragHandle'], className)}
      >
        <Icon name="drag-handle" decorative />
      </button>
    );
  },
);
