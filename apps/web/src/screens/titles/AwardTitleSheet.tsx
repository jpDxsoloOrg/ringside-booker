import { useState } from 'react';
import type { ReactNode } from 'react';
import { PUSH_LABELS, WEIGHT_CLASS_LABELS } from '@ringside/engine';
import type {
  EligibleHolders,
  EligiblePerson,
  EligibleTeam,
  IneligiblePerson,
  PersonId,
  TeamId,
  TitleHolderCount,
} from '@ringside/engine';
import { AvailabilityChip } from '@/components/AvailabilityChip';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import { TextField } from '@/components/TextField';
import styles from './TitleActions.module.css';

/** The switch that lists the people who can't hold the title. */
export const SHOW_INELIGIBLE_LABEL = "Show who can't hold it";

/** Who the player picked: the people, the team when one was picked whole, and the names to show. */
export interface AwardPick {
  readonly holderIds: readonly PersonId[];
  readonly teamId: TeamId | null;
  /** "Test Name", "Test Name & Other Name", or the team's name. */
  readonly names: string;
}

export interface AwardTitleSheetViewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly titleName: string;
  readonly holderCount: TitleHolderCount;
  /** `titles.eligibleHolders`, or null while it loads. */
  readonly holders: EligibleHolders | null;
  /** Why the list could not be loaded, or null. */
  readonly loadError: string | null;
  readonly includeIneligible: boolean;
  readonly onIncludeIneligibleChange: (include: boolean) => void;
  /** True while the award is on its way. */
  readonly pending: boolean;
  /** The engine's words for a refused award; empty when nothing was refused. */
  readonly messages: readonly string[];
  readonly onAward: (pick: AwardPick) => void;
}

/** "Pick 1 person", "Pick 2 people". */
function pickPrompt(holderCount: TitleHolderCount): string {
  return holderCount === 1 ? 'Pick 1 person' : `Pick ${formatNumber(holderCount)} people`;
}

function matches(search: string, ...names: readonly string[]): boolean {
  const needle = search.trim().toLocaleLowerCase();
  return needle === '' || names.some((name) => name.toLocaleLowerCase().includes(needle));
}

/** The muted hint under someone on another brand: where they do work. */
export function otherBrandText(person: Pick<EligiblePerson, 'brandName'>): string {
  return person.brandName === null ? 'Works across brands' : `Works on ${person.brandName}`;
}

interface PickRowProps {
  readonly type: 'checkbox' | 'radio';
  readonly name: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: () => void;
  readonly picture?: ReactNode;
  readonly label: string;
  readonly meta?: ReactNode;
  readonly end?: ReactNode;
}

/** One row of the award list: a native checkbox (or radio) and the label around everything. */
function PickRow({
  type,
  name,
  checked,
  disabled,
  onChange,
  picture,
  label,
  meta,
  end,
}: PickRowProps) {
  return (
    <li>
      <label className={styles['pick']} data-disabled={disabled ? '' : undefined}>
        <input
          className={styles['pickInput']}
          type={type}
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
        {picture ?? <span aria-hidden="true" />}
        <span className={styles['pickText']}>
          <span className={styles['pickName']}>{label}</span>
          {meta}
        </span>
        {end !== undefined && <span className={styles['pickEnd']}>{end}</span>}
      </label>
    </li>
  );
}

function personPicture(person: { personId: PersonId; ringName: string; imageRef: string | null }) {
  return (
    <ImageSlot
      subject={{
        kind: 'person',
        id: person.personId,
        name: person.ringName,
        ...(person.imageRef === null ? {} : { imageRef: person.imageRef }),
      }}
      size="sm"
      decorative
    />
  );
}

interface PickState {
  readonly selected: readonly PersonId[];
  readonly teamId: TeamId | null;
}

const NOTHING_PICKED: PickState = { selected: [], teamId: null };

/** The names of the picked people (or their team) for the confirm and the announcement. */
export function pickNames(
  pick: PickState,
  people: readonly Pick<EligiblePerson, 'personId' | 'ringName'>[],
  teams: readonly Pick<EligibleTeam, 'teamId' | 'name'>[],
): string {
  const team = teams.find((candidate) => candidate.teamId === pick.teamId);
  if (team !== undefined) return team.name;
  const byId = new Map(people.map((person) => [person.personId, person.ringName]));
  return pick.selected.map((personId) => byId.get(personId) ?? 'Someone').join(' & ');
}

/**
 * The award sheet's body and footer, fed with `titles.eligibleHolders`: a search box, then for tag
 * and trios titles the teams that could hold it (picking one fills the holders), then everyone who
 * could hold it, with a portrait, weight class, push, availability and a hint when they work on
 * another brand. Current champions are marked and can't be picked again. A switch lists the
 * people who can't hold it, each with the engine's reason. Award is ready once the title's number
 * of holders is picked; the screen asks first when that strips a champion.
 */
export function AwardTitleSheetView({
  open,
  onClose,
  titleName,
  holderCount,
  holders,
  loadError,
  includeIneligible,
  onIncludeIneligibleChange,
  pending,
  messages,
  onAward,
}: AwardTitleSheetViewProps) {
  const [search, setSearch] = useState('');
  const [pick, setPick] = useState<PickState>(NOTHING_PICKED);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSearch('');
      setPick(NOTHING_PICKED);
    }
  }

  const people = holders?.people ?? [];
  const teams = holders?.teams ?? [];
  const ineligible = holders?.ineligible ?? [];
  const single = holderCount === 1;
  const full = pick.selected.length >= holderCount;

  const togglePerson = (personId: PersonId): void => {
    setPick((current) => {
      if (single) return { selected: [personId], teamId: null };
      const selected = current.selected.includes(personId)
        ? current.selected.filter((id) => id !== personId)
        : [...current.selected, personId];
      return { selected, teamId: null };
    });
  };
  const pickTeam = (team: EligibleTeam): void => {
    setPick({ selected: team.members.map((member) => member.personId), teamId: team.teamId });
  };

  const shownTeams = teams.filter((team) =>
    matches(search, team.name, ...team.members.map((member) => member.ringName)),
  );
  const shownPeople = people.filter((person) => matches(search, person.ringName));
  const shownIneligible = ineligible.filter((person) => matches(search, person.ringName));
  const ready = pick.selected.length === holderCount;

  const body = (): ReactNode => {
    if (loadError !== null) {
      return (
        <p className={styles['refusal']} role="alert">
          {loadError}
        </p>
      );
    }
    if (holders === null) return <p className={styles['loading']}>Loading who can hold it…</p>;
    return (
      <>
        {!single && teams.length > 0 && (
          <fieldset className={styles['awardSection']}>
            <legend className={styles['sectionHeading']}>Teams</legend>
            {shownTeams.length === 0 ? (
              <p className={styles['muted']}>No team matches the search.</p>
            ) : (
              <ul className={styles['pickList']}>
                {shownTeams.map((team) => (
                  <PickRow
                    key={team.teamId}
                    type="radio"
                    name="award-team"
                    checked={pick.teamId === team.teamId}
                    disabled={team.isCurrentHolder || pending}
                    onChange={() => {
                      pickTeam(team);
                    }}
                    label={team.name}
                    meta={
                      <>
                        <span className={styles['pickMeta']}>
                          {team.members.map((member) => member.ringName).join(' & ')}
                        </span>
                        {!team.sameBrand && (
                          <span className={styles['pickHint']}>Works on another brand</span>
                        )}
                      </>
                    }
                    {...(team.isCurrentHolder
                      ? { end: <Badge tone="positive">Champions</Badge> }
                      : {})}
                  />
                ))}
              </ul>
            )}
          </fieldset>
        )}
        <fieldset className={styles['awardSection']}>
          <legend className={styles['sectionHeading']}>
            {single ? 'Wrestlers' : 'Or pick wrestlers'}
          </legend>
          {shownPeople.length === 0 ? (
            <p className={styles['muted']}>
              {people.length === 0
                ? 'Nobody on the roster can hold this title.'
                : 'Nobody matches the search.'}
            </p>
          ) : (
            <ul className={styles['pickList']}>
              {shownPeople.map((person) => {
                const checked = pick.selected.includes(person.personId);
                return (
                  <PickRow
                    key={person.personId}
                    type={single ? 'radio' : 'checkbox'}
                    name="award-person"
                    checked={checked}
                    disabled={person.isCurrentHolder || pending || (!single && !checked && full)}
                    onChange={() => {
                      togglePerson(person.personId);
                    }}
                    picture={personPicture(person)}
                    label={person.ringName}
                    meta={
                      <>
                        <span className={styles['pickMeta']}>
                          <span>{WEIGHT_CLASS_LABELS[person.weightClass]}</span>
                          <span>{PUSH_LABELS[person.push]}</span>
                        </span>
                        {!person.sameBrand && (
                          <span className={styles['pickHint']}>{otherBrandText(person)}</span>
                        )}
                      </>
                    }
                    end={
                      <>
                        {person.isCurrentHolder && <Badge tone="positive">Champion</Badge>}
                        <AvailabilityChip availability={person.availability} />
                      </>
                    }
                  />
                );
              })}
            </ul>
          )}
        </fieldset>
        {includeIneligible && (
          <IneligibleList people={shownIneligible} anyAtAll={ineligible.length > 0} />
        )}
      </>
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Award the ${titleName}`}
      side="right"
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!ready}
            onClick={() => {
              onAward({
                holderIds: pick.selected,
                teamId: pick.teamId,
                names: pickNames(pick, people, teams),
              });
            }}
          >
            Award
          </Button>
        </>
      }
    >
      <div className={styles['award']}>
        {messages.length > 0 && (
          <div className={styles['refusal']} role="alert">
            {messages.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
        <p className={styles['muted']}>
          {`${pickPrompt(holderCount)}. ${formatNumber(pick.selected.length)} of ${formatNumber(holderCount)} picked.`}
        </p>
        <TextField
          label="Search by ring name"
          type="search"
          value={search}
          onValueChange={setSearch}
          autoComplete="off"
          enterKeyHint="search"
        />
        <Switch
          label={SHOW_INELIGIBLE_LABEL}
          checked={includeIneligible}
          onCheckedChange={onIncludeIneligibleChange}
        />
        {body()}
      </div>
    </Sheet>
  );
}

function IneligibleList({
  people,
  anyAtAll,
}: {
  readonly people: readonly IneligiblePerson[];
  readonly anyAtAll: boolean;
}) {
  return (
    <fieldset className={styles['awardSection']} disabled>
      <legend className={styles['sectionHeading']}>{"Can't hold it"}</legend>
      {people.length === 0 ? (
        <p className={styles['muted']}>
          {anyAtAll ? 'Nobody matches the search.' : 'Everyone on the roster can hold it.'}
        </p>
      ) : (
        <ul className={styles['pickList']}>
          {people.map((person) => (
            <PickRow
              key={person.personId}
              type="checkbox"
              name="award-ineligible"
              checked={false}
              disabled
              onChange={() => undefined}
              picture={personPicture({ ...person, imageRef: null })}
              label={person.ringName}
              meta={
                <span className={styles['pickReason']}>
                  {person.reasons.map((reason) => reason.message).join('. ')}
                </span>
              }
            />
          ))}
        </ul>
      )}
    </fieldset>
  );
}
