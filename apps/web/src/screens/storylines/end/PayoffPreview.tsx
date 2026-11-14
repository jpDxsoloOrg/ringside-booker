import type { PayoffPlan, PersonId, TraceNode } from '@ringside/engine';
import { DeltaChip } from '@/components/DeltaChip';
import { formatSigned } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { Explained, WhyButton } from '@/components/Trace';
import {
  FINALE_PLAYED_TEXT,
  notEligibleText,
  PAYOFF_STRENGTH_LABEL,
  payoffStrengthWords,
  stillBookedText,
} from './payoffText';
import styles from './PayoffPreview.module.css';

/** One member's change as the screen shows it: the number and its breakdown. */
export interface PayoffChange {
  readonly value: number;
  readonly trace: TraceNode | null;
}

/** One member's line in a payoff, previewed or paid. */
export interface PayoffMemberLine {
  readonly personId: PersonId;
  readonly name: string;
  readonly imageRef: string | null;
  readonly popularity: PayoffChange;
  readonly momentum: PayoffChange;
  /** Why they get nothing, or null when they are paid. */
  readonly skippedReason: string | null;
}

/** Popularity changes come in tenths; momentum in whole points. */
function changeText(value: number, decimals: number): string {
  return formatSigned(value, { maximumFractionDigits: decimals });
}

function ChangeCell({
  label,
  change,
  decimals,
  memberName,
}: {
  readonly label: string;
  readonly change: PayoffChange;
  readonly decimals: number;
  readonly memberName: string;
}) {
  const display = changeText(change.value, decimals);
  return (
    <span className={styles['change']}>
      <span className={styles['changeLabel']}>{label}</span>
      <DeltaChip value={change.value} display={display} />
      {change.trace !== null && (
        <WhyButton
          label={`${label} for ${memberName}`}
          value={display}
          source={{ trace: change.trace }}
          buttonLabel={`Why ${display} ${label.toLowerCase()} for ${memberName}?`}
        />
      )}
    </span>
  );
}

/** Each member's popularity and momentum change, or why they get nothing. */
export function PayoffMemberList({ members }: { readonly members: readonly PayoffMemberLine[] }) {
  return (
    <ul className={styles['members']} aria-label="Members">
      {members.map((member) => (
        <li key={member.personId} className={styles['member']}>
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
          <span className={styles['memberName']}>{member.name}</span>
          {member.skippedReason === null ? (
            <span className={styles['changes']}>
              <ChangeCell
                label="Popularity"
                change={member.popularity}
                decimals={1}
                memberName={member.name}
              />
              <ChangeCell
                label="Momentum"
                change={member.momentum}
                decimals={0}
                memberName={member.name}
              />
            </span>
          ) : (
            <span className={styles['skipped']}>{member.skippedReason}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The plan's members as lines, with portraits from `imageRefs` where the page has them. */
export function planMemberLines(
  plan: PayoffPlan,
  imageRefs: ReadonlyMap<PersonId, string | null> = new Map(),
): PayoffMemberLine[] {
  return plan.members.map((member) => ({
    personId: member.personId,
    name: member.name,
    imageRef: imageRefs.get(member.personId) ?? null,
    popularity: { value: member.popularity.value, trace: member.popularity.trace },
    momentum: { value: member.momentum.value, trace: member.momentum.trace },
    skippedReason: member.skippedReason,
  }));
}

export interface PayoffPreviewProps {
  /** `storylines.payoff`'s plan for the active storyline. */
  readonly plan: PayoffPlan;
  /** Portraits by person, from the storyline page. */
  readonly imageRefs?: ReadonlyMap<PersonId, string | null>;
  /** Shows still to run with segments linked to the storyline: those stop counting. */
  readonly stillBookedShows?: readonly string[];
}

/**
 * What ending a storyline now would pay, as the end confirmation shows it: the payoff strength
 * with its Why?, a line when the finale has been played, then each member's popularity and
 * momentum change with a Why? each (or why they get nothing). A storyline with too few counted
 * segments says "No payoff (needs N linked segments, has M)" instead. Engine-free: the numbers
 * come from the same planner the real payoff runs, so the preview is what is applied.
 */
export function PayoffPreview({
  plan,
  imageRefs = new Map(),
  stillBookedShows = [],
}: PayoffPreviewProps) {
  return (
    <div className={styles['preview']}>
      {plan.eligible ? (
        <>
          <p className={styles['strength']}>
            <span>{PAYOFF_STRENGTH_LABEL}</span>
            <Explained
              value={plan.quality.value}
              label={PAYOFF_STRENGTH_LABEL}
              unit="ratio"
              trace={plan.quality.trace}
            />
            <span className={styles['muted']}>{payoffStrengthWords(plan.quality.value)}</span>
          </p>
          {plan.finalePlayed && <p className={styles['finale']}>{FINALE_PLAYED_TEXT}</p>}
          <PayoffMemberList members={planMemberLines(plan, imageRefs)} />
        </>
      ) : (
        <p className={styles['notEligible']}>
          {notEligibleText(plan.minSegments, plan.countedSegments)}. Ending it now still ends it,
          with no change for anyone in it.
        </p>
      )}
      {stillBookedShows.map((show) => (
        <p key={show} role="note" className={styles['warning']}>
          {stillBookedText(show)}
        </p>
      ))}
    </div>
  );
}
