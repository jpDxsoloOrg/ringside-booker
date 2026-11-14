import { explainDaysVacant, parseGameDate, parseId, reignDays } from '@ringside/engine';
import type {
  GameDate,
  PersonId,
  ReignEndReason,
  ReignRow,
  TitleRecords,
  TitleStats,
} from '@ringside/engine';
import { Stack } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { TitleLineageTable } from '@/screens/titles/TitleLineageTable';
import { TitleRecordsPanel } from '@/screens/titles/TitleRecordsPanel';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

/** Gallery data only, all invented: a title with four reigns, one a tag reign. */
const TODAY = parseGameDate('2027-06-01');
const TITLE_NAME = 'Gallery Heavyweight Title';

const MARLO = parseId('person', 'per_0000000201');
const DANTE = parseId('person', 'per_0000000202');
const KAI = parseId('person', 'per_0000000203');
const REY = parseId('person', 'per_0000000204');

const END_LABELS: Readonly<Record<ReignEndReason, string>> = {
  lost: 'Lost the title',
  vacated: 'Vacated',
  stripped: 'Stripped',
  retired: 'Title retired',
  unified: 'Unified',
};

interface SampleReign {
  readonly number: number;
  readonly holders: readonly {
    readonly personId: PersonId;
    readonly nameAtTime: string;
    readonly now?: string;
  }[];
  readonly label: string;
  readonly team?: boolean;
  readonly wonOn: string;
  readonly lostOn: string | null;
  readonly defences: number;
  readonly endReason: ReignEndReason | null;
}

function reignRow(sample: SampleReign): ReignRow {
  const wonOn: GameDate = parseGameDate(sample.wonOn);
  const lostOn = sample.lostOn === null ? null : parseGameDate(sample.lostOn);
  const days = reignDays({ wonOn, lostOn, today: TODAY });
  return {
    reignId: parseId('titleReign', `trn_00000003${String(sample.number).padStart(2, '0')}`),
    number: sample.number,
    holders: sample.holders.map((holder) => ({
      personId: holder.personId,
      nameAtTime: holder.nameAtTime,
      currentRingName: holder.now ?? holder.nameAtTime,
      imageRef: null,
    })),
    teamId: sample.team === true ? parseId('team', 'tem_0000000301') : null,
    label: sample.label,
    wonOn,
    lostOn,
    daysHeld: days.value,
    daysHeldTrace: days.trace,
    defences: sample.defences,
    endReason: sample.endReason,
    endReasonLabel: sample.endReason === null ? 'Current champion' : END_LABELS[sample.endReason],
    endTraceRef: null,
    wonInSegmentId: null,
    endedInSegmentId: null,
  };
}

const SAMPLE_REIGNS: readonly SampleReign[] = [
  {
    number: 4,
    holders: [{ personId: MARLO, nameAtTime: 'Marlo Quint' }],
    label: 'Marlo Quint',
    wonOn: '2027-03-14',
    lostOn: null,
    defences: 3,
    endReason: null,
  },
  {
    number: 3,
    holders: [
      { personId: KAI, nameAtTime: 'Kai Mercer' },
      { personId: REY, nameAtTime: 'Rey Solano' },
    ],
    label: 'The Harbour Kings',
    team: true,
    wonOn: '2026-11-02',
    lostOn: '2027-03-14',
    defences: 2,
    endReason: 'vacated',
  },
  {
    number: 2,
    holders: [{ personId: DANTE, nameAtTime: 'Dante Rivers', now: 'Dante "The Storm" Rivers' }],
    label: 'Dante Rivers',
    wonOn: '2026-02-20',
    lostOn: '2026-11-02',
    defences: 7,
    endReason: 'lost',
  },
  {
    number: 1,
    holders: [{ personId: MARLO, nameAtTime: 'Marlo Quint' }],
    label: 'Marlo Quint',
    wonOn: '2025-09-01',
    lostOn: '2026-02-20',
    defences: 4,
    endReason: 'lost',
  },
];

const REIGNS: readonly ReignRow[] = SAMPLE_REIGNS.map(reignRow);

const RECORDS: TitleRecords = {
  longestReign: { value: 255, label: 'Dante Rivers', personIds: [DANTE], reignIds: [] },
  shortestReign: { value: 132, label: 'The Harbour Kings', personIds: [KAI, REY], reignIds: [] },
  mostDefences: { value: 7, label: 'Dante Rivers', personIds: [DANTE], reignIds: [] },
  mostReigns: { value: 2, label: 'Marlo Quint', personIds: [MARLO], reignIds: [] },
  mostCombinedDays: { value: 251, label: 'Dante Rivers', personIds: [DANTE], reignIds: [] },
  oldestChampion: { value: 41, label: 'Marlo Quint', personIds: [MARLO], reignIds: [] },
  youngestChampion: { value: 26, label: 'Kai Mercer', personIds: [KAI], reignIds: [] },
};

/** Introduced decades before the first reign the sample lists, so the count starts there. */
const VACANT = explainDaysVacant({
  reigns: REIGNS,
  introducedOn: parseGameDate('1999-01-04'),
  gameStart: parseGameDate('2027-01-01'),
  until: TODAY,
  retired: false,
});

const STATS: TitleStats = {
  totalReigns: 4,
  distinctChampions: 4,
  daysVacant: VACANT.value.value,
  daysVacantTrace: VACANT.value.trace,
  historyRecordedFrom: VACANT.historyRecordedFrom,
};

const NEW_TITLE_VACANT = explainDaysVacant({
  reigns: REIGNS.slice(0, 1),
  introducedOn: REIGNS[0]?.wonOn ?? TODAY,
  gameStart: REIGNS[0]?.wonOn ?? TODAY,
  until: TODAY,
  retired: false,
});

const NO_RECORDS: TitleRecords = {
  longestReign: null,
  shortestReign: null,
  mostDefences: null,
  mostReigns: null,
  mostCombinedDays: null,
  oldestChampion: null,
  youngestChampion: null,
};

function TitleLineageDemo() {
  const [current] = REIGNS;
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Lineage, newest first</h3>
        <p className={styles['caption']}>
          Days held and how a reign ended each open a Why?. A renamed champion shows the name they
          held it under, then their name today.
        </p>
        <div className={office['stage']}>
          <Panel title="Lineage" headingLevel={3} padding="none">
            <TitleLineageTable reigns={REIGNS} titleName={TITLE_NAME} />
          </Panel>
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Records, in a side column</h3>
        <p className={styles['caption']}>
          The title is older than its first listed reign, so days vacant count from that reign and
          the panel says history before it was not recorded.
        </p>
        <div className={office['sideColumn']}>
          <TitleRecordsPanel records={RECORDS} stats={STATS} reigns={REIGNS} headingLevel={3} />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A new title with no finished reign</h3>
        <div className={office['sideColumn']}>
          <TitleRecordsPanel
            records={NO_RECORDS}
            stats={{
              totalReigns: 1,
              distinctChampions: 1,
              daysVacant: NEW_TITLE_VACANT.value.value,
              daysVacantTrace: NEW_TITLE_VACANT.value.trace,
              historyRecordedFrom: NEW_TITLE_VACANT.historyRecordedFrom,
            }}
            reigns={current === undefined ? [] : [current]}
            headingLevel={3}
          />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'title-lineage',
  title: 'Title lineage and records',
  group: 'Office',
  notes:
    'The title page’s lineage (a table on desktop, a card per reign on a phone; the order is fixed, newest first) and its records panel, with sample reigns. Days vacant count from the first recorded reign, with a Why? and a "History before ... not recorded" line. "No records yet" until a reign has ended.',
  render: () => <TitleLineageDemo />,
};
