import type { BodyPart, GameDate, InjurySeverity, InjurySource, TraceRef } from '@ringside/engine';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { classNames } from '../classNames';
import { formatGameDate } from '../format';
import { Icon } from '../Icon';
import { Panel } from '../Panel';
import type { PanelHeadingLevel } from '../Panel';
import { Explained, WhyButton } from '../Trace';
import styles from './InjuryCard.module.css';

/** The words an injury card uses; kept here so the card does not reach into a screen. */
export const INJURY_CARD_BODY_PARTS: Readonly<Record<BodyPart, string>> = {
  head: 'Head',
  neck: 'Neck',
  back: 'Back',
  arms: 'Arms',
  torso: 'Torso',
  legs: 'Legs',
};

export const INJURY_CARD_SEVERITIES: Readonly<
  Record<
    InjurySeverity,
    { readonly label: string; readonly tone: 'neutral' | 'prestige' | 'negative' }
  >
> = {
  minor: { label: 'Minor', tone: 'neutral' },
  moderate: { label: 'Moderate', tone: 'prestige' },
  severe: { label: 'Severe', tone: 'negative' },
};

export const INJURY_CARD_SOURCES: Readonly<Record<InjurySource, string>> = {
  world: 'Off-screen',
  segment: 'In a match',
};

/** One injury, in the plain shape of the engine's `InjuryView`. */
export interface InjuryCardInjury {
  readonly label: string;
  readonly bodyPart: BodyPart;
  readonly severity: InjurySeverity;
  readonly since: GameDate;
  readonly expectedReturn: GameDate;
  /** The day they came back, or null while they are still out. */
  readonly returnedOn: GameDate | null;
  readonly daysOut: number;
  /** Days to the expected return while out; null once back. */
  readonly daysRemaining: number | null;
  readonly canWorkAngles: boolean;
  readonly source: InjurySource;
  readonly conditionLoss: number;
  /** Why? for the time out; no button when null. */
  readonly durationTraceRef: TraceRef | null;
  readonly conditionLossTraceRef: TraceRef | null;
  /** The chance that led to it; the How it happened row has a Why? only when this is set. */
  readonly chanceTraceRef: TraceRef | null;
  /** Shows a "New" badge: the player has not seen this injury yet. */
  readonly pendingNotice: boolean;
}

export interface InjuryCardProps {
  readonly injury: InjuryCardInjury;
  /** Names the worker under the injury, for a card shown away from their profile. */
  readonly workerName?: string;
  /** Makes the worker's name a button that opens their profile. Needs `workerName`. */
  readonly onOpenWorker?: () => void;
  /** Leaves out the angles and How it happened rows, for a list of cards. */
  readonly compact?: boolean;
  readonly headingLevel?: PanelHeadingLevel;
  readonly className?: string | undefined;
}

function daysText(days: number): string {
  return days === 1 ? '1 day' : `${String(days)} days`;
}

function daysLeftText(days: number): string {
  return days <= 0 ? 'Back today' : daysText(days);
}

function WorkerName({
  name,
  onOpen,
}: {
  readonly name: string;
  readonly onOpen: (() => void) | undefined;
}) {
  if (onOpen === undefined) return <span className={styles['worker']}>{name}</span>;
  return (
    <Button variant="ghost" size="sm" className={styles['workerButton']} onClick={onOpen}>
      {name}
    </Button>
  );
}

/**
 * An injury as a card (WRK6-05): what it is, the body part and how bad (a severity badge whose
 * word is always shown, so it is never colour alone), "New" while the player has not seen it,
 * then Since, Back on, the time out and days left, the condition it cost, whether they can still
 * work angles and how it happened. Numbers with a kept breakdown get a Why?; the rest show plain.
 * A healed injury reads as history: Back on is the day they came back and there are no days left.
 */
export function InjuryCard({
  injury,
  workerName,
  onOpenWorker,
  compact = false,
  headingLevel = 3,
  className,
}: InjuryCardProps) {
  const severity = INJURY_CARD_SEVERITIES[injury.severity];
  const healed = injury.returnedOn !== null;
  const bodyPart = INJURY_CARD_BODY_PARTS[injury.bodyPart];
  return (
    <Panel
      as="section"
      variant="office"
      headingLevel={headingLevel}
      className={classNames(styles['card'], healed && styles['healed'], className)}
      title={
        <span className={styles['heading']}>
          <Icon name="injured" decorative />
          <span className={styles['label']}>{injury.label}</span>
        </span>
      }
      subtitle={
        <span className={styles['subtitle']}>
          {workerName !== undefined && <WorkerName name={workerName} onOpen={onOpenWorker} />}
          <span>{bodyPart}</span>
          {healed && <span>Healed</span>}
        </span>
      }
      actions={
        <span className={styles['badges']}>
          <Badge tone={severity.tone}>{severity.label}</Badge>
          {injury.pendingNotice && (
            <Badge tone="action" variant="solid">
              New
            </Badge>
          )}
        </span>
      }
    >
      <dl className={styles['rows']}>
        <div className={styles['row']}>
          <dt>Since</dt>
          <dd>{formatGameDate(injury.since)}</dd>
        </div>
        <div className={styles['row']}>
          <dt>Back on</dt>
          <dd>{formatGameDate(injury.returnedOn ?? injury.expectedReturn)}</dd>
        </div>
        <div className={styles['row']}>
          <dt>Time out</dt>
          <dd>
            <Explained
              value={injury.daysOut}
              unit="days"
              label="Time out"
              traceRef={injury.durationTraceRef}
            />
          </dd>
        </div>
        {injury.daysRemaining !== null && !healed && (
          <div className={styles['row']}>
            <dt>Days left</dt>
            <dd className="tabular">{daysLeftText(injury.daysRemaining)}</dd>
          </div>
        )}
        <div className={styles['row']}>
          <dt>Condition lost</dt>
          <dd>
            <Explained
              value={injury.conditionLoss}
              unit="points"
              label="Condition lost"
              traceRef={injury.conditionLossTraceRef}
            />
          </dd>
        </div>
        {!compact && (
          <>
            <div className={styles['row']}>
              <dt>Can work angles</dt>
              <dd>{injury.canWorkAngles ? 'Yes' : 'No'}</dd>
            </div>
            <div className={styles['row']}>
              <dt>How it happened</dt>
              <dd className={styles['how']}>
                <span>{INJURY_CARD_SOURCES[injury.source]}</span>
                {injury.chanceTraceRef !== null && (
                  <WhyButton
                    label="Injury chance"
                    value={INJURY_CARD_SOURCES[injury.source]}
                    source={{ traceRef: injury.chanceTraceRef }}
                    buttonLabel={`Why did ${injury.label} happen?`}
                  />
                )}
              </dd>
            </div>
          </>
        )}
      </dl>
    </Panel>
  );
}
