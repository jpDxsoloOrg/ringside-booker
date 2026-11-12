import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Alignment, AvailabilityStatus, PersonId, TeamId } from '@ringside/engine';
import { AlignmentChip } from '../AlignmentChip';
import { AVAILABILITY_TONES } from '../AvailabilityChip';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { classNames } from '../classNames';
import { EmptyState } from '../EmptyState';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { ImageSlot } from '../ImageSlot';
import { Sheet } from '../Sheet';
import styles from './RosterPicker.module.css';

/** How long the search box waits after the last key before it searches. */
export const ROSTER_SEARCH_DEBOUNCE_MS = 200;

/** Most characters the search box takes. */
export const ROSTER_SEARCH_MAX_LENGTH = 60;

/** Someone the picker lists. */
export interface RosterPickerPerson {
  readonly personId: PersonId;
  readonly name: string;
  readonly imageRef: string | null;
  /** "Main event", "Mid card"; null to leave it out. */
  readonly pushLabel: string | null;
  readonly alignment: Alignment | null;
  readonly availability: {
    readonly status: AvailabilityStatus;
    /** The chip: "Available", "Injured until 12 Feb". */
    readonly label: string;
  };
  /** True when the row can be picked. */
  readonly selectable: boolean;
  /**
   * True when they could be booked at all: Bookable only keeps these. Someone bookable but
   * already placed stays listed, unselectable, with the reason. Defaults to `selectable`.
   */
  readonly bookable?: boolean;
  /** Why the row can't be picked, read out as its description. Null when it can. */
  readonly reason: string | null;
  /** True when they work for another brand than the show's. */
  readonly otherBrand: boolean;
  /** True when they are already booked in another segment of this card: Hide booked drops them. */
  readonly bookedElsewhere?: boolean;
  /** Short notes after the chips: "Other brand: Altura Overclock", "On this card: Opener". */
  readonly notes: readonly string[];
}

/** A team the picker lists; picking it adds every member. */
export interface RosterPickerTeam {
  readonly teamId: TeamId;
  readonly name: string;
  readonly memberNames: readonly string[];
  readonly selectable: boolean;
  /** True when every member could be booked; defaults to `selectable`. */
  readonly bookable?: boolean;
  readonly reason: string | null;
  /** True when any member works for another brand than the show's. */
  readonly otherBrand: boolean;
  /** True when any member is already booked in another segment of this card. */
  readonly bookedElsewhere?: boolean;
}

export type RosterPickerMode = 'people' | 'teams';

export interface RosterPickerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** "Add to Side 1". */
  readonly title: string;
  readonly people: readonly RosterPickerPerson[];
  /** Teams to offer; left out, there is no Teams filter. */
  readonly teams?: readonly RosterPickerTeam[];
  /** Which list the picker opens on. `people` by default. */
  readonly initialMode?: RosterPickerMode;
  /** True while the list is loading. */
  readonly loading?: boolean;
  /** The trimmed search, {@link ROSTER_SEARCH_DEBOUNCE_MS} after the last key. */
  readonly onSearchChange: (search: string) => void;
  readonly onPickPerson: (person: RosterPickerPerson) => void;
  readonly onPickTeam?: (team: RosterPickerTeam) => void;
  /** A line above the list, such as "Side 1: 1 of 2". */
  readonly status?: string;
  /**
   * Offer the Hide booked filter (on when the picker opens), which drops rows marked
   * `bookedElsewhere`. Off by default, for pickers that aren't building a card.
   */
  readonly bookedFilter?: boolean;
}

function isBookable(row: { readonly selectable: boolean; readonly bookable?: boolean }): boolean {
  return row.bookable ?? row.selectable;
}

function isBookedElsewhere(row: { readonly bookedElsewhere?: boolean }): boolean {
  return row.bookedElsewhere ?? false;
}

const AVAILABILITY_ICONS: Readonly<Record<AvailabilityStatus, IconName>> = {
  available: 'check',
  injured: 'injured',
  rehab: 'injured',
  personalLeave: 'calendar',
  suspended: 'lock',
  timeOff: 'calendar',
  notDebuted: 'info',
  retired: 'history',
};

export interface AvailabilityBadgeProps {
  readonly status: AvailabilityStatus;
  readonly label: string;
  readonly className?: string | undefined;
}

/** Availability as a plain chip: an icon and the words, never colour alone. */
export function AvailabilityBadge({ status, label, className }: AvailabilityBadgeProps) {
  return (
    <Badge tone={AVAILABILITY_TONES[status]} className={classNames(styles['badge'], className)}>
      <Icon name={AVAILABILITY_ICONS[status]} size="sm" decorative />
      {label}
    </Badge>
  );
}

interface FilterChipProps {
  readonly pressed: boolean;
  readonly onToggle: () => void;
  readonly children: string;
}

function FilterChip({ pressed, onToggle, children }: FilterChipProps) {
  return (
    <button type="button" className={styles['filter']} aria-pressed={pressed} onClick={onToggle}>
      {pressed && <Icon name="check" size="sm" decorative />}
      {children}
    </button>
  );
}

/** A row of either list, as the listbox draws it. */
interface PickerRow {
  readonly key: string;
  readonly selectable: boolean;
  readonly reason: string | null;
  readonly pick: () => void;
  readonly content: ReactNode;
  readonly name: string;
}

function personContent(person: RosterPickerPerson) {
  return (
    <>
      <ImageSlot
        subject={{
          kind: 'person',
          id: person.personId,
          name: person.name,
          ...(person.imageRef === null ? {} : { imageRef: person.imageRef }),
        }}
        size="sm"
        decorative
      />
      <span className={styles['rowText']}>
        <span className={styles['rowName']}>{person.name}</span>
        <span className={styles['rowChips']}>
          {person.pushLabel !== null && <span className={styles['push']}>{person.pushLabel}</span>}
          {person.alignment !== null && <AlignmentChip alignment={person.alignment} size="sm" />}
          <AvailabilityBadge
            status={person.availability.status}
            label={person.availability.label}
          />
          {person.notes.map((note) => (
            <span key={note} className={styles['note']}>
              {note}
            </span>
          ))}
        </span>
      </span>
    </>
  );
}

function teamContent(team: RosterPickerTeam) {
  return (
    <>
      <span className={styles['teamIcon']} aria-hidden="true">
        <Icon name="users" decorative />
      </span>
      <span className={styles['rowText']}>
        <span className={styles['rowName']}>{team.name}</span>
        <span className={styles['rowChips']}>
          <span className={styles['push']}>{team.memberNames.join(' & ')}</span>
          {team.otherBrand && <span className={styles['note']}>Other brand</span>}
        </span>
      </span>
    </>
  );
}

/**
 * Picks people (or a team) for one side of a segment: a debounced search, filter chips and a list
 * of rows with each person's push, alignment and availability. Rows that can't be picked are
 * dimmed, say why as their description, and do nothing when chosen.
 *
 * The search box drives the list as a combobox: Up and Down move through the rows, Enter picks the
 * highlighted one, and Escape closes the sheet. A tap or click picks a row too. A side sheet on
 * desktop, a bottom sheet on a phone.
 *
 * The picker shows what it is given; the screen fetches the rows (the booking editor reads
 * `booking.availableWorkers`) and decides what picking means.
 */
export function RosterPicker({
  open,
  onClose,
  title,
  people,
  teams,
  initialMode = 'people',
  loading = false,
  onSearchChange,
  onPickPerson,
  onPickTeam,
  status,
  bookedFilter = false,
}: RosterPickerProps) {
  const [text, setText] = useState('');
  const [bookableOnly, setBookableOnly] = useState(true);
  const [thisBrand, setThisBrand] = useState(false);
  const [hideBooked, setHideBooked] = useState(bookedFilter);
  const [mode, setMode] = useState<RosterPickerMode>(initialMode);
  const [active, setActive] = useState(0);
  const searchId = useId();
  const listId = useId();
  const statusId = useId();

  // Each opening starts afresh on the list it was asked for.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText('');
      setHideBooked(bookedFilter);
      setMode(initialMode);
      setActive(0);
    }
  }

  const onSearchRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchRef.current = onSearchChange;
  }, [onSearchChange]);
  const trimmed = text.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onSearchRef.current(trimmed);
    }, ROSTER_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  const showingTeams = mode === 'teams' && teams !== undefined;
  const hidingBooked = bookedFilter && hideBooked;
  const rows = useMemo<readonly PickerRow[]>(() => {
    if (showingTeams) {
      return teams
        .filter((team) => !bookableOnly || isBookable(team))
        .filter((team) => !thisBrand || !team.otherBrand)
        .filter((team) => !hidingBooked || !isBookedElsewhere(team))
        .map((team) => ({
          key: team.teamId,
          selectable: team.selectable,
          reason: team.reason,
          name: team.name,
          pick: () => {
            onPickTeam?.(team);
          },
          content: teamContent(team),
        }));
    }
    return people
      .filter((person) => !bookableOnly || isBookable(person))
      .filter((person) => !thisBrand || !person.otherBrand)
      .filter((person) => !hidingBooked || !isBookedElsewhere(person))
      .map((person) => ({
        key: person.personId,
        selectable: person.selectable,
        reason: person.reason,
        name: person.name,
        pick: () => {
          onPickPerson(person);
        },
        content: personContent(person),
      }));
  }, [
    bookableOnly,
    hidingBooked,
    onPickPerson,
    onPickTeam,
    people,
    showingTeams,
    teams,
    thisBrand,
  ]);

  const activeIndex = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  const optionId = (index: number): string => `${listId}-option-${String(index)}`;

  useEffect(() => {
    if (activeIndex < 0) return;
    const option = document.getElementById(`${listId}-option-${String(activeIndex)}`);
    option?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listId]);

  const choose = (row: PickerRow | undefined): void => {
    if (row?.selectable === true) row.pick();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(activeIndex + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Home' && event.ctrlKey) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End' && event.ctrlKey) {
      event.preventDefault();
      setActive(rows.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(rows[activeIndex]);
    }
  };

  const listLabel = showingTeams ? 'Teams' : 'People';
  // Rows each filter hides (after the brand filter), so the list can say so. Someone both
  // unbookable and booked elsewhere counts once, under Bookable only.
  const candidates: readonly {
    readonly selectable: boolean;
    readonly bookable?: boolean;
    readonly otherBrand: boolean;
    readonly bookedElsewhere?: boolean;
  }[] = (showingTeams ? teams : people).filter((row) => !thisBrand || !row.otherBrand);
  const hidden = bookableOnly ? candidates.filter((row) => !isBookable(row)).length : 0;
  const hiddenBooked = hidingBooked
    ? candidates.filter((row) => isBookedElsewhere(row) && (!bookableOnly || isBookable(row)))
        .length
    : 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      side="right"
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className={styles['picker']}>
        <div className={styles['search']}>
          <label htmlFor={searchId} className={styles['searchLabel']}>
            Search by name
          </label>
          <div className={styles['searchWrap']}>
            <Icon name="search" size="sm" className={styles['searchIcon']} decorative />
            <input
              id={searchId}
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex < 0 ? undefined : optionId(activeIndex)}
              aria-describedby={status === undefined ? undefined : statusId}
              className={styles['searchInput']}
              value={text}
              maxLength={ROSTER_SEARCH_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setText(event.target.value);
                setActive(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        <div className={styles['filters']} role="group" aria-label="Filters">
          <FilterChip
            pressed={bookableOnly}
            onToggle={() => {
              setBookableOnly(!bookableOnly);
              setActive(0);
            }}
          >
            Bookable only
          </FilterChip>
          <FilterChip
            pressed={thisBrand}
            onToggle={() => {
              setThisBrand(!thisBrand);
              setActive(0);
            }}
          >
            This brand
          </FilterChip>
          {bookedFilter && (
            <FilterChip
              pressed={hideBooked}
              onToggle={() => {
                setHideBooked(!hideBooked);
                setActive(0);
              }}
            >
              Hide booked
            </FilterChip>
          )}
          {teams !== undefined && (
            <FilterChip
              pressed={showingTeams}
              onToggle={() => {
                setMode(showingTeams ? 'people' : 'teams');
                setActive(0);
              }}
            >
              Teams
            </FilterChip>
          )}
        </div>
        {status !== undefined && (
          <p id={statusId} className={styles['status']} aria-live="polite">
            {status}
          </p>
        )}
        {loading && rows.length === 0 ? (
          <p className={styles['status']} role="status">
            Loading the roster…
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="user-search"
            title={trimmed === '' ? `No ${listLabel.toLowerCase()} to list` : 'Nobody by that name'}
            body={
              hidden > 0
                ? 'Turn off Bookable only to see everyone, with why they can’t be booked.'
                : hiddenBooked > 0
                  ? 'Everyone left is already on this card. Turn off Hide booked to see them.'
                  : 'Try another name.'
            }
          />
        ) : (
          <ul id={listId} role="listbox" aria-label={listLabel} className={styles['list']}>
            {rows.map((row, index) => {
              const reasonId = `${optionId(index)}-reason`;
              return (
                <li
                  key={row.key}
                  id={optionId(index)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === activeIndex}
                  aria-disabled={!row.selectable}
                  aria-describedby={row.reason === null ? undefined : reasonId}
                  className={styles['row']}
                  data-active={index === activeIndex ? '' : undefined}
                  data-selectable={row.selectable ? '' : undefined}
                  onMouseMove={() => {
                    if (index !== activeIndex) setActive(index);
                  }}
                  onClick={() => {
                    setActive(index);
                    choose(row);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      choose(row);
                    }
                  }}
                >
                  <span className={styles['rowMain']}>{row.content}</span>
                  {row.reason !== null && (
                    <span id={reasonId} className={styles['reason']}>
                      {row.reason}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {hidden > 0 && rows.length > 0 && (
          <p className={styles['status']}>
            {`${String(hidden)} ${hidden === 1 ? 'more is' : 'more are'} hidden because they can’t be booked. Turn off Bookable only to see why.`}
          </p>
        )}
        {hiddenBooked > 0 && rows.length > 0 && (
          <p className={styles['status']}>
            {`${String(hiddenBooked)} already on this card ${hiddenBooked === 1 ? 'is' : 'are'} hidden. Turn off Hide booked to see them.`}
          </p>
        )}
      </div>
    </Sheet>
  );
}
