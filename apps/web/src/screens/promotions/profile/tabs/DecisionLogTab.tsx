import { useMemo, useState } from 'react';
import type { AipDecisionLog, AipDecisionLogArgs, AiDecisionId } from '@ringside/engine';
import { useEngineClient } from '@/app/engine/EngineProvider';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { DecisionLogList } from '@/components/DecisionLogList';
import { EmptyState } from '@/components/EmptyState';
import type { PromotionTabContext } from '../promotionTabs';
import styles from '../PromotionProfile.module.css';

/** Older pages loaded with "Load older", for one filter. */
interface OlderPages {
  readonly kind: string | null;
  readonly log: Pick<AipDecisionLog, 'entries' | 'nextBefore'>;
}

/** The first page with the older pages appended: one log for the list to draw. */
export function mergeDecisionLog(
  first: AipDecisionLog,
  older: Pick<AipDecisionLog, 'entries' | 'nextBefore'> | null,
): AipDecisionLog {
  if (older === null) return first;
  return { ...first, entries: [...first.entries, ...older.entries], nextBefore: older.nextBefore };
}

/** The tab is shown for a rival, and for your own promotion only when the computer runs a brand. */
export function decisionLogVisible({ isOwn, profile }: PromotionTabContext): boolean {
  return !isOwn || profile.header.brands.some((brand) => brand.controlledBy === 'computer');
}

/**
 * The rival desk's decision log for the promotion, newest first, with filter chips by kind. Plans
 * that have not aired yet are counted, not shown. "Load older" asks for the next page and appends
 * it; changing the filter starts again from the newest.
 */
export function DecisionLogTab({ promotionId }: PromotionTabContext) {
  const client = useEngineClient();
  const [kind, setKind] = useState<string | null>(null);
  const [older, setOlder] = useState<OlderPages | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const args = useMemo(
    (): AipDecisionLogArgs => (kind === null ? { promotionId } : { promotionId, kinds: [kind] }),
    [promotionId, kind],
  );
  const first = useEngineQuery('aip.decisionLog', args, { keepPreviousData: true });

  if (first.status === 'error') {
    return (
      <div className={styles['tab']}>
        <EmptyState icon="history" size="inline" title="The decision log could not be loaded" />
      </div>
    );
  }
  if (first.data === undefined) {
    return (
      <div className={styles['tab']} aria-busy="true">
        <p className={styles['muted']}>Loading the decision log…</p>
      </div>
    );
  }

  const log = mergeDecisionLog(first.data, older?.kind === kind ? older.log : null);
  const loadOlder = async (before: AiDecisionId): Promise<void> => {
    setLoadingOlder(true);
    try {
      const { result } = await client.query('aip.decisionLog', { ...args, before });
      if (result.ok) {
        const previous = older?.kind === kind ? older.log.entries : [];
        setOlder({
          kind,
          log: {
            entries: [...previous, ...result.data.entries],
            nextBefore: result.data.nextBefore,
          },
        });
      }
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div className={styles['tab']}>
      <DecisionLogList
        log={log}
        selectedKind={kind}
        onKindChange={(next) => {
          setKind(next);
          setOlder(null);
        }}
        loadingOlder={loadingOlder}
        onLoadOlder={() => {
          if (log.nextBefore !== null) void loadOlder(log.nextBefore);
        }}
      />
    </div>
  );
}
