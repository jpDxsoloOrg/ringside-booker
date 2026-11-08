/**
 * The distribution report: what the world a pack set produces looks like, in numbers.
 *
 * Generated content goes wrong quietly. A skewed profile gives a roster of 40-year-olds or a crowd
 * of 90-rated rookies and nothing errors, so every content change prints this report and the
 * markdown form can be committed and diffed between revisions. The output depends only on the
 * merged content and the start date: rows are sorted by key, numbers are rounded the same way
 * everywhere, and nothing reads the clock or the machine.
 */

import {
  ATTRIBUTE_KEYS,
  GENDERS,
  PERSON_ROLES,
  PUSH_LEVELS,
  RING_STYLES,
  ageInYears,
  compareDates,
  type AttributeKey,
  type GameDate,
  type GameWorldView,
  type MergedContent,
} from '@ringside/engine';
import { freeAgentKeys } from './rules/freeAgents';
import {
  activeEmployments,
  isWrestler,
  refKey,
  sortedRecords,
  worldStartDate,
  type PersonRecord,
} from './rules/helpers';

export type ColumnAlign = 'left' | 'right';

export interface ReportTable {
  readonly title: string;
  /** One sentence under the title saying how the numbers are worked out. */
  readonly note?: string;
  readonly columns: readonly string[];
  readonly align: readonly ColumnAlign[];
  readonly rows: readonly (readonly string[])[];
}

export interface DistributionReport {
  readonly heading: string;
  /** Label and value pairs printed before the tables. */
  readonly summary: readonly (readonly [string, string])[];
  readonly tables: readonly ReportTable[];
}

/** Width of an age bucket in years. */
export const AGE_BUCKET_YEARS = 5;

/** How many regions the popularity table lists. */
export const TOP_REGION_COUNT = 10;

/** The popularity a promotion needs in a region for the region to count in its footprint. */
export const FOOTPRINT_MIN_POPULARITY = 20;

/**
 * Career stages by years since debut on the start date. The stages are a reporting view only;
 * people do not store a stage.
 */
export const CAREER_STAGES = [
  { stage: 'undebuted', fromYears: null },
  { stage: 'rookie', fromYears: 0 },
  { stage: 'prospect', fromYears: 3 },
  { stage: 'established', fromYears: 6 },
  { stage: 'veteran', fromYears: 12 },
  { stage: 'legend', fromYears: 20 },
] as const;

export type CareerStage = (typeof CAREER_STAGES)[number]['stage'];

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** Fixed decimals, with negative zero shown as zero. */
function fixed(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

function count(value: number): string {
  return String(value);
}

/** A table whose first column is left-aligned and every other column is a number. */
function numberTable(
  title: string,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  note?: string,
): ReportTable {
  return {
    title,
    ...(note === undefined ? {} : { note }),
    columns,
    align: columns.map((_, index) => (index === 0 ? 'left' : 'right')),
    rows,
  };
}

export function careerStageOf(person: PersonRecord, start: GameDate): CareerStage {
  if (person.debutDate === null || compareDates(person.debutDate, start) > 0) {
    return 'undebuted';
  }
  const years = ageInYears(person.debutDate, start);
  let stage: CareerStage = 'rookie';
  for (const entry of CAREER_STAGES) {
    if (entry.fromYears !== null && years >= entry.fromYears) {
      stage = entry.stage;
    }
  }
  return stage;
}

function ageOf(person: PersonRecord, start: GameDate): number | null {
  return compareDates(person.birthDate, start) > 0 ? null : ageInYears(person.birthDate, start);
}

interface Stats {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly min: number;
  readonly max: number;
}

/** Population mean, standard deviation, minimum and maximum. */
export function describe(values: readonly number[]): Stats | null {
  if (values.length === 0) {
    return null;
  }
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    sum += value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const mean = sum / values.length;
  let squares = 0;
  for (const value of values) {
    squares += (value - mean) ** 2;
  }
  return { n: values.length, mean, sd: Math.sqrt(squares / values.length), min, max };
}

type PersonEntry = readonly [string, PersonRecord];

function rolesPresent(people: readonly PersonEntry[]): string[] {
  const roles = new Set<string>();
  for (const [, person] of people) {
    for (const role of person.roles) {
      roles.add(role);
    }
  }
  return [...roles].sort(compareText);
}

function peopleByRoleAndGender(people: readonly PersonEntry[]): ReportTable {
  const genders = [...GENDERS].sort(compareText);
  const rows = [...PERSON_ROLES].sort(compareText).map((role) => {
    const holders = people.filter(([, person]) => person.roles.includes(role));
    return [
      role,
      ...genders.map((gender) =>
        count(holders.filter(([, person]) => person.gender === gender).length),
      ),
      count(holders.length),
    ];
  });
  rows.push([
    'everyone',
    ...genders.map((gender) =>
      count(people.filter(([, person]) => person.gender === gender).length),
    ),
    count(people.length),
  ]);
  return numberTable(
    'People by role and gender',
    ['role', ...genders, 'total'],
    rows,
    'A person with several roles is counted once in each role.',
  );
}

function ageHistogram(people: readonly PersonEntry[], start: GameDate): ReportTable {
  const roles = rolesPresent(people);
  const aged = people
    .map(([, person]) => ({ person, age: ageOf(person, start) }))
    .filter((entry): entry is { person: PersonRecord; age: number } => entry.age !== null);
  const buckets = aged.map(({ age }) => Math.floor(age / AGE_BUCKET_YEARS));
  const rows: string[][] = [];
  if (buckets.length > 0) {
    const lowest = Math.min(...buckets);
    const highest = Math.max(...buckets);
    for (let bucket = lowest; bucket <= highest; bucket += 1) {
      const inBucket = aged.filter(({ age }) => Math.floor(age / AGE_BUCKET_YEARS) === bucket);
      const from = bucket * AGE_BUCKET_YEARS;
      rows.push([
        `${String(from)}-${String(from + AGE_BUCKET_YEARS - 1)}`,
        ...roles.map((role) =>
          count(inBucket.filter(({ person }) => person.roles.some((held) => held === role)).length),
        ),
        count(inBucket.length),
      ]);
    }
  }
  return numberTable(
    `Age on the start date by role (${String(AGE_BUCKET_YEARS)}-year buckets)`,
    ['age', ...roles, 'total'],
    rows,
  );
}

function styleCounts(people: readonly PersonEntry[]): ReportTable {
  const rows = [...RING_STYLES]
    .sort(compareText)
    .map((style) => [style, count(people.filter(([, person]) => person.style === style).length)]);
  return numberTable('Ring styles', ['style', 'people'], rows);
}

function attributeRows(
  groups: readonly (readonly [string, readonly PersonRecord[]])[],
): string[][] {
  const rows: string[][] = [];
  for (const attribute of ATTRIBUTE_KEYS) {
    for (const [group, members] of groups) {
      const stats = describe(members.map((person) => attributeValue(person, attribute)));
      if (stats === null) {
        continue;
      }
      rows.push([
        attribute,
        group,
        count(stats.n),
        fixed(stats.mean, 1),
        fixed(stats.sd, 1),
        fixed(stats.min, 1),
        fixed(stats.max, 1),
      ]);
    }
  }
  return rows;
}

function attributeValue(person: PersonRecord, attribute: AttributeKey): number {
  return person.attributes[attribute];
}

const ATTRIBUTE_COLUMNS = ['n', 'mean', 'sd', 'min', 'max'];

function attributesByRole(people: readonly PersonEntry[]): ReportTable {
  const groups = rolesPresent(people).map(
    (role) =>
      [
        role,
        people
          .filter(([, person]) => person.roles.some((held) => held === role))
          .map(([, person]) => person),
      ] as const,
  );
  return {
    title: 'Attributes by role',
    columns: ['attribute', 'role', ...ATTRIBUTE_COLUMNS],
    align: ['left', 'left', ...ATTRIBUTE_COLUMNS.map((): ColumnAlign => 'right')],
    rows: attributeRows(groups),
  };
}

function attributesByStage(people: readonly PersonEntry[], start: GameDate): ReportTable {
  const groups = CAREER_STAGES.map(
    ({ stage }) =>
      [
        stage,
        people
          .filter(([, person]) => careerStageOf(person, start) === stage)
          .map(([, person]) => person),
      ] as const,
  );
  return {
    title: 'Attributes by career stage',
    note: 'Stage by years since debut on the start date: rookie under 3, prospect 3-5, established 6-11, veteran 12-19, legend 20 or more.',
    columns: ['attribute', 'stage', ...ATTRIBUTE_COLUMNS],
    align: ['left', 'left', ...ATTRIBUTE_COLUMNS.map((): ColumnAlign => 'right')],
    rows: attributeRows(groups),
  };
}

function rosters(content: MergedContent, start: GameDate): ReportTable {
  const running = activeEmployments(content, start);
  const pushes = [...PUSH_LEVELS];
  const rows = sortedRecords(content, 'promotion').map(([key, merged]) => {
    const contracts = running.filter(
      ([, employment]) => refKey(employment.record.promotionKey) === key,
    );
    const wrestlers = contracts.filter(([, employment]) => employment.record.role === 'wrestler');
    return [
      key,
      merged.record.status,
      count(contracts.length),
      count(wrestlers.length),
      count(contracts.length - wrestlers.length),
      ...pushes.map((push) =>
        count(wrestlers.filter(([, employment]) => employment.record.push === push).length),
      ),
    ];
  });
  return {
    title: 'Rosters and push mix',
    note: 'Contracts running on the start date; the push columns count wrestler contracts only.',
    columns: ['promotion', 'status', 'contracts', 'wrestlers', 'staff', ...pushes],
    align: [
      'left',
      'left',
      ...['contracts', 'wrestlers', 'staff', ...pushes].map((): ColumnAlign => 'right'),
    ],
    rows,
  };
}

function titlesPerPromotion(content: MergedContent): ReportTable {
  const titles = sortedRecords(content, 'title');
  const openReignTitles = new Set(
    sortedRecords(content, 'titleReign')
      .filter(([, merged]) => merged.record.lostOn === null)
      .map(([, merged]) => refKey(merged.record.titleKey)),
  );
  const rows = sortedRecords(content, 'promotion').map(([key]) => {
    const own = titles.filter(([, merged]) => refKey(merged.record.promotionKey) === key);
    const active = own.filter(([, merged]) => merged.record.status === 'active');
    return [
      key,
      count(active.length),
      count(own.length - active.length),
      count(active.filter(([titleKey]) => openReignTitles.has(titleKey)).length),
    ];
  });
  return numberTable(
    'Titles per promotion',
    ['promotion', 'active', 'retired', 'with champion'],
    rows,
  );
}

function topRegions(content: MergedContent, people: readonly PersonEntry[]): ReportTable {
  const totals = new Map<string, { sum: number; known: number }>();
  for (const [, person] of people) {
    for (const [regionRef, popularity] of Object.entries(person.regionalPop).sort(
      ([left], [right]) => compareText(left, right),
    )) {
      const regionKey = regionRef.includes(':')
        ? (regionRef.split(':')[1] ?? regionRef)
        : regionRef;
      const total = totals.get(regionKey) ?? { sum: 0, known: 0 };
      totals.set(regionKey, { sum: total.sum + popularity, known: total.known + 1 });
    }
  }
  const population = Math.max(people.length, 1);
  const ranked = sortedRecords(content, 'region')
    .map(([key, merged]) => {
      const total = totals.get(key) ?? { sum: 0, known: 0 };
      return {
        key,
        countryKey: refKey(merged.record.countryKey),
        mean: total.sum / population,
        known: total.known,
      };
    })
    .sort((left, right) => right.mean - left.mean || compareText(left.key, right.key))
    .slice(0, TOP_REGION_COUNT);
  return {
    title: `Top ${String(TOP_REGION_COUNT)} regions by mean worker popularity`,
    note: 'Mean over every person in the world, counting a person unknown in the region as 0.',
    columns: ['rank', 'region', 'country', 'mean', 'people known'],
    align: ['right', 'left', 'left', 'right', 'right'],
    rows: ranked.map((entry, index) => [
      count(index + 1),
      entry.key,
      entry.countryKey,
      fixed(entry.mean, 2),
      count(entry.known),
    ]),
  };
}

function promotionFootprints(content: MergedContent): ReportTable {
  const rows = sortedRecords(content, 'promotion').map(([key, merged]) => {
    const regions = Object.entries(merged.record.regionalPop)
      .filter(([, popularity]) => popularity >= FOOTPRINT_MIN_POPULARITY)
      .map(([regionRef]) =>
        regionRef.includes(':') ? (regionRef.split(':')[1] ?? regionRef) : regionRef,
      )
      .sort(compareText);
    return [key, count(regions.length), regions.length === 0 ? '-' : regions.join(', ')];
  });
  return {
    title: `Promotion popularity footprint (regions at ${String(FOOTPRINT_MIN_POPULARITY)} or more)`,
    columns: ['promotion', 'regions', 'where'],
    align: ['left', 'right', 'left'],
    rows,
  };
}

/** Builds the report for a loaded world and the content it came from. */
export function buildReport(world: GameWorldView, content: MergedContent): DistributionReport {
  const start = worldStartDate(world);
  const people: PersonEntry[] = sortedRecords(content, 'person').map(
    ([key, merged]) => [key, merged.record] as const,
  );
  const employed = new Set(
    activeEmployments(content, start).map(([, merged]) => refKey(merged.record.personKey)),
  );
  const freeAgentWrestlers = freeAgentKeys(world, content).length;
  const wrestlers = people.filter(([, person]) => isWrestler(person)).length;

  return {
    heading: `World report: ${world.meta.worldName}`,
    summary: [
      ['Start date', start],
      ['Packs', content.packs.map((pack) => `${pack.id}@${pack.version}`).join(', ')],
      ['People', count(people.length)],
      ['Wrestlers', count(wrestlers)],
      ['Promotions', count(content.records.promotion.size)],
      ['Titles', count(content.records.title.size)],
      ['Contracts running', count(activeEmployments(content, start).length)],
      ['Free-agent wrestlers', count(freeAgentWrestlers)],
      ['People without a contract', count(people.filter(([key]) => !employed.has(key)).length)],
    ],
    tables: [
      peopleByRoleAndGender(people),
      ageHistogram(people, start),
      styleCounts(people),
      attributesByRole(people),
      attributesByStage(people, start),
      rosters(content, start),
      titlesPerPromotion(content),
      topRegions(content, people),
      promotionFootprints(content),
    ],
  };
}

function columnWidths(table: ReportTable, minimum: number): number[] {
  return table.columns.map((column, index) =>
    Math.max(minimum, column.length, ...table.rows.map((row) => (row[index] ?? '').length)),
  );
}

function pad(text: string, width: number, align: ColumnAlign): string {
  return align === 'right' ? text.padStart(width) : text.padEnd(width);
}

/** The report as aligned plain-text tables, for the terminal. */
export function renderReportText(report: DistributionReport): string {
  const lines: string[] = [report.heading, '='.repeat(report.heading.length), ''];
  const labelWidth = Math.max(...report.summary.map(([label]) => label.length));
  for (const [label, value] of report.summary) {
    lines.push(`${label.padEnd(labelWidth)}  ${value}`);
  }
  for (const table of report.tables) {
    lines.push('', table.title, '-'.repeat(table.title.length));
    if (table.note !== undefined) {
      lines.push(table.note);
    }
    if (table.rows.length === 0) {
      lines.push('(none)');
      continue;
    }
    const widths = columnWidths(table, 1);
    const render = (cells: readonly string[]): string =>
      cells
        .map((cell, index) => pad(cell, widths[index] ?? 0, table.align[index] ?? 'left'))
        .join('  ')
        .trimEnd();
    lines.push(render(table.columns));
    lines.push(widths.map((width) => '-'.repeat(width)).join('  '));
    for (const row of table.rows) {
      lines.push(render(row));
    }
  }
  return `${lines.join('\n')}\n`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** The report as GitHub-flavoured markdown, laid out the way Prettier formats tables. */
export function renderReportMarkdown(report: DistributionReport): string {
  const lines: string[] = [`# ${report.heading}`, ''];
  for (const [label, value] of report.summary) {
    lines.push(`- **${label}:** ${escapeCell(value)}`);
  }
  for (const table of report.tables) {
    lines.push('', `## ${table.title}`, '');
    if (table.note !== undefined) {
      lines.push(table.note, '');
    }
    if (table.rows.length === 0) {
      lines.push('None.');
      continue;
    }
    const escaped: ReportTable = {
      ...table,
      columns: table.columns.map(escapeCell),
      rows: table.rows.map((row) => row.map(escapeCell)),
    };
    const widths = columnWidths(escaped, 3);
    const render = (cells: readonly string[]): string =>
      `| ${cells.map((cell, index) => pad(cell, widths[index] ?? 0, table.align[index] ?? 'left')).join(' | ')} |`;
    lines.push(render(escaped.columns));
    lines.push(
      `| ${widths
        .map((width, index) =>
          table.align[index] === 'right' ? `${'-'.repeat(width - 1)}:` : '-'.repeat(width),
        )
        .join(' | ')} |`,
    );
    for (const row of escaped.rows) {
      lines.push(render(row));
    }
  }
  return `${lines.join('\n')}\n`;
}
