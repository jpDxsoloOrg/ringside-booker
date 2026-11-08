import { cents, parseGameDate } from '@ringside/engine';
import {
  formatDaysBetween,
  formatGameDate,
  formatMoney,
  formatNumber,
  formatPercent,
  formatSigned,
} from '@/components/format';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

interface FormatExample {
  readonly call: string;
  readonly result: string;
}

function formatExamples(): readonly FormatExample[] {
  const newYear = parseGameDate('2031-01-01');
  return [
    { call: 'formatMoney(cents(123456700))', result: formatMoney(cents(123456700)) },
    {
      call: "formatMoney(cents(123456700), { style: 'compact' })",
      result: formatMoney(cents(123456700), { style: 'compact' }),
    },
    {
      call: "formatMoney(cents(-250000000), { style: 'compact' })",
      result: formatMoney(cents(-250000000), { style: 'compact' }),
    },
    {
      call: 'formatMoney(cents(123456789), { showCents: true })',
      result: formatMoney(cents(123456789), { showCents: true }),
    },
    { call: 'formatMoney(cents(0))', result: formatMoney(cents(0)) },
    { call: 'formatNumber(48210)', result: formatNumber(48210) },
    { call: 'formatPercent(0.125, 1)', result: formatPercent(0.125, 1) },
    { call: 'formatSigned(6)', result: formatSigned(6) },
    { call: 'formatSigned(-3)', result: formatSigned(-3) },
    { call: "formatGameDate('2031-01-01')", result: formatGameDate(newYear) },
    { call: "formatGameDate('2031-01-01', 'long')", result: formatGameDate(newYear, 'long') },
    {
      call: "formatDaysBetween('2031-01-01', '2031-01-08')",
      result: formatDaysBetween(newYear, parseGameDate('2031-01-08')),
    },
  ];
}

function FormatterSamples() {
  return (
    <dl className={styles['formatList']}>
      {formatExamples().map((example) => (
        <div key={example.call} className={styles['formatRow']}>
          <dt>{example.call}</dt>
          <dd>{example.result}</dd>
        </div>
      ))}
    </dl>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'formatters',
  title: 'Formatters',
  group: 'Primitives',
  notes: 'Money is integer Cents and dates are GameDate strings; these turn them into text.',
  render: () => <FormatterSamples />,
};
