import { useEffect, useId, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { routes } from '@/app/routes';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Cluster } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { classNames } from '@/components/classNames';
import { applyTheme, SELECTABLE_THEME_PREFERENCES } from '@/styles/theme';
import type { ThemePreference } from '@/styles/theme';
import { useIsMobile } from '@/styles/useMediaQuery';
import { galleryEntries } from './entries';
import { GALLERY_GROUPS } from './galleryEntry';
import type { GalleryEntry, GalleryGroup } from './galleryEntry';
import styles from './GalleryScreen.module.css';
import { useThemePreference } from './useThemeState';

/** Path of the bare page the phone frame loads: one entry, no gallery chrome. */
export const GALLERY_FRAME_PATH = routes.dev.galleryFrame();

const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

interface EntryGroup {
  readonly group: GalleryGroup;
  readonly entries: readonly GalleryEntry[];
}

/** The groups that have entries, in display order. */
function groupEntries(entries: readonly GalleryEntry[]): readonly EntryGroup[] {
  return GALLERY_GROUPS.map((group) => ({
    group,
    entries: entries.filter((entry) => entry.group === group),
  })).filter((entryGroup) => entryGroup.entries.length > 0);
}

/** The entry a `#hash` names, or undefined. */
export function findGalleryEntry(hash: string): GalleryEntry | undefined {
  const requestedId = decodeURIComponent(hash.replace(/^#/, ''));
  return galleryEntries.find((entry) => entry.id === requestedId);
}

/** Renders an entry. A component of its own so the entry's hooks belong to it. */
function EntryContent({ entry }: { readonly entry: GalleryEntry }) {
  return <>{entry.render()}</>;
}

/**
 * Switches between the themes a player can choose. Dark is the only shipped theme for now (D-11),
 * so with fewer than two choices there is nothing to switch and the toggle is left out.
 */
function ThemeToggle() {
  const preference = useThemePreference();
  const labelId = useId();

  if (SELECTABLE_THEME_PREFERENCES.length < 2) return null;

  return (
    <Cluster gap={2}>
      <span className={styles['toolLabel']} id={labelId}>
        Theme
      </span>
      <div role="group" aria-labelledby={labelId}>
        <Cluster gap={1}>
          {SELECTABLE_THEME_PREFERENCES.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === preference ? 'primary' : 'secondary'}
              aria-pressed={option === preference}
              onClick={() => {
                applyTheme(option);
              }}
            >
              {THEME_LABELS[option]}
            </Button>
          ))}
        </Cluster>
      </div>
    </Cluster>
  );
}

interface EntryNavProps {
  readonly groups: readonly EntryGroup[];
  readonly selectedId: string | undefined;
}

/** Desktop: the grouped entry list down the left. */
function EntryList({ groups, selectedId }: EntryNavProps) {
  const baseId = useId();

  return (
    <nav aria-label="Gallery entries" className={styles['entryList']}>
      {groups.map(({ group, entries }) => {
        const groupLabelId = `${baseId}-${group}`;
        return (
          <div key={group} className={styles['entryGroup']}>
            <p id={groupLabelId} className={styles['groupLabel']}>
              {group}
            </p>
            <ul aria-labelledby={groupLabelId} className={styles['entryLinks']}>
              {entries.map((entry) => {
                const isSelected = entry.id === selectedId;
                return (
                  <li key={entry.id}>
                    <Link
                      to={{ hash: entry.id }}
                      aria-current={isSelected ? 'true' : undefined}
                      className={classNames(styles['entryLink'], isSelected && styles['selected'])}
                    >
                      {entry.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Phones: the same list as a select at the top. */
function EntryPicker({ groups, selectedId }: EntryNavProps) {
  const navigate = useNavigate();
  const selectId = useId();

  return (
    <div className={styles['entryPicker']}>
      <label htmlFor={selectId} className={styles['toolLabel']}>
        Entry
      </label>
      <select
        id={selectId}
        className={styles['select']}
        value={selectedId ?? ''}
        onChange={(event) => {
          navigate({ hash: event.target.value });
        }}
      >
        {groups.map(({ group, entries }) => (
          <optgroup key={group} label={group}>
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

interface PhoneFrameProps {
  readonly entry: GalleryEntry;
  readonly preference: ThemePreference;
}

/**
 * The entry in a 390px-wide frame. It is an iframe, so the entry sees a phone-sized viewport and
 * its `--bp-mobile` rules apply, the same as on a real phone.
 */
function PhoneFrame({ entry, preference }: PhoneFrameProps) {
  const source = `${import.meta.env.BASE_URL.replace(/\/$/, '')}${GALLERY_FRAME_PATH}?theme=${preference}#${entry.id}`;
  return (
    <div className={styles['phoneFrame']}>
      <iframe
        className={styles['phoneFrameViewport']}
        src={source}
        title={`${entry.title} at phone width`}
      />
    </div>
  );
}

/**
 * The component gallery at /dev/gallery: every finished UI building block, one entry at a time,
 * with theme and phone-frame controls. Ships in every build but is linked from no navigation.
 */
export function GalleryScreen() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const preference = useThemePreference();
  const [isPhoneFrameOn, setIsPhoneFrameOn] = useState(false);

  const groups = groupEntries(galleryEntries);
  const selectedEntry = findGalleryEntry(location.hash) ?? galleryEntries[0];
  const showPhoneFrame = isPhoneFrameOn && !isMobile;

  return (
    <main className={styles['screen']}>
      <header className={styles['header']}>
        <h1 className={styles['title']}>Component gallery</h1>
        <p className={styles['lead']}>
          Every finished UI building block. Check each one at desktop and at phone width.
        </p>
        <Cluster gap={6} className={styles['toolbar']}>
          <ThemeToggle />
          <div className={styles['desktopOnly']}>
            <Button
              size="sm"
              aria-pressed={isPhoneFrameOn}
              variant={isPhoneFrameOn ? 'primary' : 'secondary'}
              onClick={() => {
                setIsPhoneFrameOn((wasOn) => !wasOn);
              }}
            >
              Phone frame
            </Button>
          </div>
        </Cluster>
        <EntryPicker groups={groups} selectedId={selectedEntry?.id} />
      </header>

      <div className={styles['body']}>
        <EntryList groups={groups} selectedId={selectedEntry?.id} />
        {selectedEntry === undefined ? (
          <EmptyState
            icon="search"
            title="No gallery entries yet"
            body="Add a *.gallery.tsx file under screens/dev-gallery/entries."
          />
        ) : (
          <Panel
            key={selectedEntry.id}
            id="gallery-entry"
            title={selectedEntry.title}
            subtitle={selectedEntry.group}
            className={styles['entry']}
          >
            <div className={styles['entryBody']} data-gallery-entry={selectedEntry.id}>
              {selectedEntry.notes === undefined ? null : (
                <p className={styles['notes']}>{selectedEntry.notes}</p>
              )}
              {showPhoneFrame ? (
                <PhoneFrame entry={selectedEntry} preference={preference} />
              ) : (
                <EntryContent entry={selectedEntry} />
              )}
            </div>
          </Panel>
        )}
      </div>
    </main>
  );
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * The page inside the phone frame: one entry and nothing else. The theme comes from `?theme=` so
 * the frame matches the gallery around it.
 */
export function GalleryFrameScreen() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requestedTheme = searchParams.get('theme');
  const entry = findGalleryEntry(location.hash) ?? galleryEntries[0];

  useEffect(() => {
    if (isThemePreference(requestedTheme)) applyTheme(requestedTheme);
  }, [requestedTheme]);

  return (
    <main className={styles['frameScreen']}>
      <h1 className={styles['frameTitle']}>{entry?.title ?? 'Component gallery'}</h1>
      {entry === undefined ? null : <EntryContent entry={entry} />}
    </main>
  );
}
