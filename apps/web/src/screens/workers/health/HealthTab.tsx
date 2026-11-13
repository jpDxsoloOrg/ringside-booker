/**
 * The worker profile's Health tab (WRK6-05): condition per body part with the cap for their age,
 * fatigue, the medical care they get, the current injury and the injury history, all from
 * `health.profile`. Health is public, so a rival's worker shows the same tab. Opening the tab on
 * one of the player's own workers with a new injury marks it as seen, which lets the day move on.
 * Loaded with the tab (see `registerHealthTab.tsx`).
 */
import { useEffect, useRef } from 'react';
import type {
  BodyPartHealth,
  HealthProfile,
  InjuryId,
  InjuryView,
  PersonId,
} from '@ringside/engine';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate } from '@/components/format';
import { InjuryCard } from '@/components/InjuryCard';
import { Panel } from '@/components/Panel';
import { SegmentedMeter } from '@/components/SegmentedMeter';
import { StatBar } from '@/components/StatBar';
import { Explained } from '@/components/Trace';
import {
  BODY_PART_LABELS,
  FATIGUE_BAND_LABELS,
  SEVERITY_LABELS,
  SEVERITY_TONES,
} from './healthText';
import styles from './HealthTab.module.css';

/** A part below this reads as a weak spot (the bar turns red-orange). */
export const CONDITION_LOW_BELOW = 40;

/** Fatigue from here on is Spent: the meter's danger zone. */
export const FATIGUE_DANGER_FROM = 75;

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'The engine gave no reason.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ') || 'The engine gave no reason.';
}

/** "Medical care: Altura Wrestling Entertainment, level 3", or the free-agent line. */
export function medicalLine(medical: HealthProfile['medical']): string {
  const level = `level ${String(medical.level)}`;
  return medical.promotionName === null
    ? `Medical care: no employer, ${level}`
    : `Medical care: ${medical.promotionName}, ${level}`;
}

function ConditionRow({ part }: { readonly part: BodyPartHealth }) {
  const name = BODY_PART_LABELS[part.part];
  return (
    <li className={styles['conditionRow']}>
      <div className={styles['barLine']}>
        <StatBar
          label={name}
          value={Math.round(part.value)}
          ceiling={part.cap.value}
          ceilingLabel="age cap"
          lowBelow={CONDITION_LOW_BELOW}
        />
        {part.injured && (
          <Badge tone="negative" className={styles['injured']}>
            Injured
          </Badge>
        )}
      </div>
      <dl className={styles['partFacts']}>
        <div className={styles['fact']}>
          <dt>Next week</dt>
          <dd>
            <Explained
              value={part.nextCheck.value}
              unit="points"
              label={`${name}: next weekly recovery`}
              trace={part.nextCheck.trace}
            />
          </dd>
        </div>
        <div className={styles['fact']}>
          <dt>Age cap</dt>
          <dd>
            <Explained
              value={part.cap.value}
              unit="points"
              label={`${name}: age cap`}
              trace={part.cap.trace}
            />
          </dd>
        </div>
      </dl>
    </li>
  );
}

function daysOutCell(injury: InjuryView) {
  return (
    <Explained
      value={injury.daysOut}
      unit="days"
      label={`Time out, ${injury.label} from ${formatGameDate(injury.since)}`}
      traceRef={injury.durationTraceRef}
    />
  );
}

const HISTORY_COLUMNS: readonly ColumnDef<InjuryView>[] = [
  {
    id: 'injury',
    header: 'Injury',
    card: 'title',
    cell: (injury) => injury.label,
  },
  {
    id: 'bodyPart',
    header: 'Body part',
    card: 'subtitle',
    cell: (injury) => BODY_PART_LABELS[injury.bodyPart],
  },
  {
    id: 'severity',
    header: 'Severity',
    card: 'meta',
    cell: (injury) => (
      <Badge tone={SEVERITY_TONES[injury.severity]}>{SEVERITY_LABELS[injury.severity]}</Badge>
    ),
  },
  {
    id: 'from',
    header: 'From',
    card: 'meta',
    cell: (injury) => formatGameDate(injury.since),
  },
  {
    id: 'back',
    header: 'Back',
    card: 'meta',
    cell: (injury) => formatGameDate(injury.returnedOn ?? injury.expectedReturn),
  },
  {
    id: 'daysOut',
    header: 'Days out',
    card: 'stat',
    align: 'end',
    cell: daysOutCell,
  },
];

/**
 * Marks every injury the profile says the player has not seen yet, once per injury: a ref keeps
 * re-renders (and the refetch the command itself causes) from sending it again. A refusal only
 * means it was seen already, so it is ignored.
 */
function useAcknowledgeOnView(profile: HealthProfile | undefined): void {
  const { run } = useEngineCommand('health.acknowledgeInjuries');
  const sent = useRef(new Set<InjuryId>());
  useEffect(() => {
    if (profile === undefined) return;
    const toSend = pendingInjuryIds(profile).filter((id) => !sent.current.has(id));
    if (toSend.length === 0) return;
    for (const id of toSend) sent.current.add(id);
    const acknowledge = async (): Promise<void> => {
      try {
        await run({ injuryIds: toSend });
      } catch {
        // A transport failure: the stop stays up and says why; nothing to show here.
      }
    };
    void acknowledge();
  }, [profile, run]);
}

/** The ids of the injuries in the profile still waiting to be seen by the viewer. */
export function pendingInjuryIds(profile: HealthProfile): InjuryId[] {
  return [profile.current, ...profile.history]
    .filter((injury): injury is InjuryView => injury?.pendingNotice === true)
    .map((injury) => injury.injuryId);
}

export function HealthPanel({ personId }: { readonly personId: PersonId }) {
  const query = useEngineQuery('health.profile', { personId });
  useAcknowledgeOnView(query.data ?? undefined);

  if (query.status === 'loading') {
    return (
      <p className={styles['notice']} role="status">
        Loading health…
      </p>
    );
  }
  if (query.status === 'error' || query.data === undefined || query.data === null) {
    return <EmptyState icon="error" title="Health can't be shown" body={errorText(query.error)} />;
  }
  const profile = query.data;
  const { fatigue } = profile;
  return (
    <div className={styles['health']}>
      <Panel
        title="Condition"
        subtitle="Each part heals a little every Monday, up to the cap for their age"
      >
        <ul className={styles['conditionList']}>
          {profile.condition.map((part) => (
            <ConditionRow key={part.part} part={part} />
          ))}
        </ul>
      </Panel>

      <div className={styles['side']}>
        <Panel title="Fatigue">
          <div className={styles['fatigue']}>
            <SegmentedMeter
              label="Fatigue"
              value={Math.round(fatigue.value)}
              dangerFrom={FATIGUE_DANGER_FROM}
              dangerLabel="Spent"
              showValue={false}
            />
            <p className={styles['fatigueLine']}>
              <span className={styles['band']}>{FATIGUE_BAND_LABELS[fatigue.band]}</span>
              <Explained
                value={fatigue.value}
                unit="points"
                label="Fatigue"
                traceRef={fatigue.traceRef}
              />
            </p>
          </div>
          <p className={styles['medical']}>{medicalLine(profile.medical)}</p>
        </Panel>

        {profile.current === null ? (
          <Panel title="Injury">
            <EmptyState
              icon="check"
              title="Fit to work"
              body="No current injury."
              size="inline"
              headingLevel={3}
            />
          </Panel>
        ) : (
          <InjuryCard injury={profile.current} headingLevel={2} />
        )}
      </div>

      <Panel
        title="Injury history"
        subtitle={
          profile.history.length === 0
            ? 'Newest first'
            : 'Newest first. Details are kept for the last 4 weeks.'
        }
        padding="none"
        className={styles['history']}
      >
        <DataTable
          rows={profile.history}
          columns={HISTORY_COLUMNS}
          getRowId={(injury) => injury.injuryId}
          getRowLabel={(injury) => `${injury.label}, ${formatGameDate(injury.since)}`}
          caption="Injury history, newest first"
          emptyState={
            <EmptyState
              icon="history"
              title="No injuries on record"
              size="inline"
              headingLevel={3}
            />
          }
        />
      </Panel>
    </div>
  );
}
