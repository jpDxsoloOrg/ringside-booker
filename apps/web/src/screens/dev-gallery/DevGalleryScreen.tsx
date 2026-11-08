import { cents, parseGameDate } from '@ringside/engine';
import { useState } from 'react';
import { CountBadge, Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import type { ButtonVariant } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import {
  formatDaysBetween,
  formatGameDate,
  formatMoney,
  formatNumber,
  formatPercent,
  formatSigned,
} from '@/components/format';
import { Icon, ICON_NAMES } from '@/components/Icon';
import { Cluster, Stack } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { StatBar } from '@/components/StatBar';
import { TONES } from '@/components/tone';
import { applyTheme } from '@/styles/theme';
import type { ThemePreference } from '@/styles/theme';
import styles from './DevGalleryScreen.module.css';
import { DataTableDemo } from './DataTableDemo';
import { ImageSlotDemo } from './ImageSlotDemo';

interface GalleryEntry {
  /** Stable key and the section's anchor id, used by the e2e spec. */
  readonly id: string;
  /** Component name as shown in the list. */
  readonly title: string;
}

/** One section per component, in page order. Add an entry when a component is built. */
export const galleryEntries: readonly GalleryEntry[] = [
  { id: 'gallery-button', title: 'Button' },
  { id: 'gallery-icon', title: 'Icon' },
  { id: 'gallery-panel', title: 'Panel' },
  { id: 'gallery-badge', title: 'Badge' },
  { id: 'gallery-stat-bar', title: 'StatBar' },
  { id: 'gallery-empty-state', title: 'EmptyState' },
  { id: 'gallery-layout', title: 'Layout' },
  { id: 'gallery-format', title: 'Formatters' },
  { id: 'gallery-image-slot', title: 'ImageSlot' },
  { id: 'gallery-data-table', title: 'DataTable' },
];

function sectionTitle(id: string): string {
  return galleryEntries.find((entry) => entry.id === id)?.title ?? id;
}

const BUTTON_VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemePreference>('system');

  return (
    <Cluster gap={2}>
      <span className={styles['groupLabel']} id="gallery-theme-label">
        Theme
      </span>
      <div role="group" aria-labelledby="gallery-theme-label">
        <Cluster gap={1}>
          {THEME_PREFERENCES.map((preference) => (
            <Button
              key={preference}
              size="sm"
              variant={preference === theme ? 'primary' : 'secondary'}
              aria-pressed={preference === theme}
              onClick={() => {
                applyTheme(preference);
                setTheme(preference);
              }}
            >
              {preference}
            </Button>
          ))}
        </Cluster>
      </div>
    </Cluster>
  );
}

function ButtonSection() {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <Stack gap={5}>
      {BUTTON_VARIANTS.map((variant) => (
        <div key={variant} className={styles['example']}>
          <h3 className={styles['subheading']}>{variant}</h3>
          <Cluster gap={2}>
            <Button variant={variant}>Book show</Button>
            <Button variant={variant} size="sm">
              Small
            </Button>
            <Button variant={variant} iconStart="play">
              Run show
            </Button>
            <Button variant={variant} iconEnd="chevron-right">
              Next day
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} loading>
              Loading
            </Button>
          </Cluster>
        </div>
      ))}
      <div className={styles['example']}>
        <h3 className={styles['subheading']}>Icon buttons</h3>
        <Cluster gap={2}>
          {BUTTON_VARIANTS.map((variant) => (
            <IconButton
              key={variant}
              icon="settings"
              label={`Settings (${variant})`}
              variant={variant}
            />
          ))}
          <IconButton icon="close" label="Close (small)" size="sm" />
          <IconButton icon="trash" label="Delete" variant="danger" size="sm" />
        </Cluster>
      </div>
      <div className={styles['example']}>
        <h3 className={styles['subheading']}>Loading keeps its width</h3>
        <Cluster gap={2}>
          <Button variant="primary" loading={isSaving} iconStart="download">
            Save game
          </Button>
          <Button
            aria-pressed={isSaving}
            onClick={() => {
              setIsSaving((wasSaving) => !wasSaving);
            }}
          >
            Toggle loading
          </Button>
        </Cluster>
      </div>
    </Stack>
  );
}

function IconSection() {
  return (
    <Stack gap={4}>
      <ul className={styles['iconGrid']}>
        {ICON_NAMES.map((name) => (
          <li key={name} className={styles['iconTile']}>
            <Icon name={name} size="md" />
            {name}
          </li>
        ))}
      </ul>
      <Cluster gap={4} align="end">
        <Icon name="star" size="sm" title="Small star" />
        <Icon name="star" size="md" title="Medium star" />
        <Icon name="star" size="lg" title="Large star" />
        <span className={styles['caption']}>sm, md and lg, each with a title</span>
      </Cluster>
    </Stack>
  );
}

function PanelSection() {
  return (
    <Stack gap={4}>
      <Panel
        title="Plain panel"
        subtitle="With a subtitle and an action"
        headingLevel={3}
        actions={
          <Button size="sm" iconStart="settings">
            Edit
          </Button>
        }
      >
        <p>Body content sits on the surface with medium padding.</p>
      </Panel>
      <Panel title="Collapsible panel" subtitle="Open to start" headingLevel={3} collapsible>
        <p>Enter or Space on the title shows and hides this.</p>
      </Panel>
      <Panel title="Starts collapsed" headingLevel={3} collapsible defaultCollapsed>
        <p>Hidden until opened.</p>
      </Panel>
      <Panel title="No padding" as="div" headingLevel={3} padding="none">
        <div className={styles['demoBox']}>Content runs to the panel edge.</div>
      </Panel>
    </Stack>
  );
}

function BadgeSection() {
  return (
    <Stack gap={4}>
      <div className={styles['example']}>
        <h3 className={styles['subheading']}>Soft</h3>
        <Cluster gap={2}>
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </Cluster>
      </div>
      <div className={styles['example']}>
        <h3 className={styles['subheading']}>Solid</h3>
        <Cluster gap={2}>
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone} variant="solid">
              {tone}
            </Badge>
          ))}
        </Cluster>
      </div>
      <div className={styles['example']}>
        <h3 className={styles['subheading']}>CountBadge</h3>
        <Cluster gap={6}>
          <Cluster gap={2}>
            <span className={styles['caption']}>0:</span>
            <CountBadge count={0} label="0 unread" />
            <span className={styles['caption']}>(hidden)</span>
          </Cluster>
          <Cluster gap={2}>
            <span className={styles['caption']}>0 with showZero:</span>
            <CountBadge count={0} showZero tone="neutral" label="0 unread" />
          </Cluster>
          <Cluster gap={2}>
            <span className={styles['caption']}>3:</span>
            <CountBadge count={3} label="3 unread" />
          </Cluster>
          <Cluster gap={2}>
            <span className={styles['caption']}>150:</span>
            <CountBadge count={150} label="150 unread" />
          </Cluster>
        </Cluster>
      </div>
    </Stack>
  );
}

const STAT_BAR_VALUES = [0, 35, 70, 100, 120] as const;

function StatBarSection() {
  return (
    <div className={styles['statGrid']}>
      {STAT_BAR_VALUES.map((value) => (
        <StatBar key={value} label={`Value ${String(value)}`} value={value} />
      ))}
      <StatBar label="With potential" value={55} ceiling={82} />
      <StatBar label="Recent gain" value={72} delta={6} ceiling={90} />
      <StatBar label="Recent loss" value={48} delta={-8} />
      <StatBar label="Out of 20" value={14} max={20} tone="info" />
      <StatBar label="Hidden value" value={64} showValue={false} tone="accent" />
    </div>
  );
}

function EmptyStateSection() {
  return (
    <Stack gap={4}>
      <Panel title="Inline" as="div" headingLevel={3} padding="none">
        <EmptyState
          icon="search"
          title="No workers match these filters"
          body="Clear a filter to see more of the roster."
        />
      </Panel>
      <Panel title="Page" as="div" headingLevel={3} padding="none">
        <EmptyState
          size="page"
          icon="calendar"
          title="Nothing booked yet"
          body="Your first show is a blank card. Fill the slots to see the forecast."
          action={
            <Button variant="primary" iconStart="play">
              Book a show
            </Button>
          }
        />
      </Panel>
    </Stack>
  );
}

function LayoutSection() {
  return (
    <Stack gap={4}>
      <div className={styles['example']}>
        <h3 className={styles['subheading']}>Stack, gap 2</h3>
        <Stack gap={2}>
          <div className={styles['demoBox']}>One</div>
          <div className={styles['demoBox']}>Two</div>
          <div className={styles['demoBox']}>Three</div>
        </Stack>
      </div>
      <div className={styles['example']}>
        <h3 className={styles['subheading']}>Cluster, gap 3, wraps on narrow screens</h3>
        <Cluster gap={3}>
          {['Opener', 'Midcard', 'Midcard', 'Semi-main', 'Main event', 'Pre-show'].map(
            (slot, index) => (
              <div key={`${slot}-${String(index)}`} className={styles['demoBox']}>
                {slot}
              </div>
            ),
          )}
        </Cluster>
      </div>
      <div className={styles['example']}>
        <h3 className={styles['subheading']}>Cluster, justify between</h3>
        <Cluster gap={3} justify="between">
          <div className={styles['demoBox']}>Start</div>
          <div className={styles['demoBox']}>End</div>
        </Cluster>
      </div>
    </Stack>
  );
}

interface FormatExample {
  readonly call: string;
  readonly result: string;
}

function formatExamples(): readonly FormatExample[] {
  const today = parseGameDate('2031-01-01');
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
    { call: "formatGameDate('2031-01-01')", result: formatGameDate(today) },
    { call: "formatGameDate('2031-01-01', 'long')", result: formatGameDate(today, 'long') },
    {
      call: "formatDaysBetween('2031-01-01', '2031-01-08')",
      result: formatDaysBetween(today, parseGameDate('2031-01-08')),
    },
  ];
}

function FormatSection() {
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

/** Dev-only page showing every shared UI component. Not part of release builds. */
export function DevGalleryScreen() {
  return (
    <main className={styles['screen']}>
      <div className={styles['intro']}>
        <h1 className={styles['title']}>Component gallery</h1>
        <p className={styles['lead']}>
          Every shared component in each of its states. Check it at desktop and phone widths and in
          both themes.
        </p>
        <ThemeSwitcher />
        <nav aria-label="Gallery sections" className={styles['sectionNav']}>
          <Cluster as="ul" gap={3}>
            {galleryEntries.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`}>{entry.title}</a>
              </li>
            ))}
          </Cluster>
        </nav>
      </div>

      <Panel id="gallery-button" title={sectionTitle('gallery-button')}>
        <ButtonSection />
      </Panel>
      <Panel id="gallery-icon" title={sectionTitle('gallery-icon')}>
        <IconSection />
      </Panel>
      <Panel id="gallery-panel" title={sectionTitle('gallery-panel')}>
        <PanelSection />
      </Panel>
      <Panel id="gallery-badge" title={sectionTitle('gallery-badge')}>
        <BadgeSection />
      </Panel>
      <Panel id="gallery-stat-bar" title={sectionTitle('gallery-stat-bar')}>
        <StatBarSection />
      </Panel>
      <Panel id="gallery-empty-state" title={sectionTitle('gallery-empty-state')}>
        <EmptyStateSection />
      </Panel>
      <Panel id="gallery-layout" title={sectionTitle('gallery-layout')}>
        <LayoutSection />
      </Panel>
      <Panel id="gallery-format" title={sectionTitle('gallery-format')}>
        <FormatSection />
      </Panel>
      <Panel id="gallery-image-slot" title={sectionTitle('gallery-image-slot')}>
        <ImageSlotDemo />
      </Panel>
      <Panel id="gallery-data-table" title={sectionTitle('gallery-data-table')}>
        <DataTableDemo />
      </Panel>
    </main>
  );
}
