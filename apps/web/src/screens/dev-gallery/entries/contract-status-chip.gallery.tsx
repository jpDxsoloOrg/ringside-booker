import { parseGameDate } from '@ringside/engine';
import { ContractStatusChip } from '@/components/ContractStatusChip';
import type { ContractStatus } from '@/components/ContractStatusChip';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

/** One sample of every state, in the order a contract row lists them. */
const RUNNING: readonly ContractStatus[] = [
  { kind: 'active' },
  { kind: 'starts', on: parseGameDate('2027-03-01') },
  { kind: 'expiring', daysLeft: 59, warn: false },
  { kind: 'expiring', daysLeft: 12, warn: true },
  { kind: 'unseen' },
];

const UNHAPPY: readonly ContractStatus[] = [
  { kind: 'wantsToLeave' },
  { kind: 'unhappy', days: 9, of: 14, paused: false },
  { kind: 'unhappy', days: 9, of: 14, paused: true },
  { kind: 'walkoutRisk', chance: 0.025 },
];

const ENDED: readonly ContractStatus[] = [
  { kind: 'ended', reason: 'expired' },
  { kind: 'ended', reason: 'released' },
  { kind: 'ended', reason: 'quit' },
  { kind: 'ended', reason: 'walkedOut' },
  { kind: 'ended', reason: 'exclusiveDeal' },
  { kind: 'ended', reason: 'withdrawn' },
];

function Row({
  title,
  statuses,
}: {
  readonly title: string;
  readonly statuses: readonly ContractStatus[];
}) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={office['chipRow']}>
        {statuses.map((status, index) => (
          <ContractStatusChip key={`${status.kind}-${String(index)}`} status={status} />
        ))}
      </div>
    </section>
  );
}

function ContractStatusChipDemo() {
  return (
    <Stack gap={5}>
      <Row title="Running" statuses={RUNNING} />
      <Row title="Unhappy workers" statuses={UNHAPPY} />
      <Row title="Ended" statuses={ENDED} />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'contract-status-chip',
  title: 'ContractStatusChip',
  group: 'Office',
  notes:
    'Where a contract stands (ECO4-04): green running, cyan starting later, gold ending soon (plain outside the expiring-soon window), a solid "New" for a notice not yet seen, red for a worker who wants to leave or may walk out, gold for the unhappy clock, and plain for how a contract ended. The words always say it; colour never stands alone.',
  render: () => <ContractStatusChipDemo />,
};
