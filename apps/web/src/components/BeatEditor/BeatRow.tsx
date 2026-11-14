import type { TraceNode } from '@ringside/engine';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { Badge } from '../Badge';
import { Button, IconButton } from '../Button';
import { CardSlotDragHandle } from '../CardSlot';
import { classNames } from '../classNames';
import { Select } from '../Select';
import type { SelectOption } from '../Select';
import { useSortableHandle } from '../SortableList';
import { Explained } from '../Trace';
import type { BeatDraft, BeatGroupOption, BeatOption, PersonChip } from './beatDraft';
import styles from './BeatEditor.module.css';

export type BeatHeadingLevel = 2 | 3 | 4 | 5 | 6;
export type BeatGroupNumber = 1 | 2;
export type MoveDirection = 'up' | 'down';

const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const;

/** A beat's score and how it was worked out, from `match.previewAngle`. */
export interface BeatScore {
  readonly value: number;
  readonly trace: TraceNode;
}

/** The name a beat goes by in labels: its catalog name, or a plain stand-in for an unknown key. */
export function beatNameOf(option: BeatOption | undefined): string {
  return option?.name ?? 'Unknown beat';
}

/** "Needs someone" / "Needs at least 2" while a required group is short, else null. */
function shortfallText(group: BeatGroupOption, count: number): string | null {
  if (group.optional || count >= group.minPeople) return null;
  return group.minPeople <= 1 ? 'Needs someone' : `Needs at least ${String(group.minPeople)}`;
}

interface BeatGroupViewProps {
  readonly beatIndex: number;
  readonly group: BeatGroupOption;
  readonly people: readonly PersonChip[];
  readonly disabled: boolean;
  readonly personExtras: ((person: PersonChip, beatIndex: number) => ReactNode) | undefined;
  readonly onAddPerson: () => void;
  readonly onRemovePerson: (person: PersonChip) => void;
}

function BeatGroupView({
  beatIndex,
  group,
  people,
  disabled,
  personExtras,
  onAddPerson,
  onRemovePerson,
}: BeatGroupViewProps) {
  const labelId = useId();
  const fullId = useId();
  const full = people.length >= group.maxPeople;
  const shortfall = shortfallText(group, people.length);
  return (
    <div role="group" aria-labelledby={labelId} className={styles['group']}>
      <p id={labelId} className={styles['groupLabel']}>
        {group.label}
        {group.optional && <span className={styles['optional']}> (optional)</span>}
      </p>
      {people.length > 0 && (
        <ul className={styles['chips']}>
          {people.map((person) => (
            <li key={person.id} className={styles['chip']}>
              <span className={styles['chipName']}>{person.name}</span>
              {personExtras?.(person, beatIndex)}
              {!disabled && (
                <IconButton
                  icon="close"
                  size="sm"
                  label={`Remove ${person.name} from ${group.label}`}
                  className={styles['chipRemove']}
                  onClick={() => {
                    onRemovePerson(person);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {people.length === 0 && group.optional && <p className={styles['groupNote']}>Nobody</p>}
      {shortfall !== null && <p className={styles['groupNote']}>{shortfall}</p>}
      {!disabled && (
        <div className={styles['groupActions']}>
          <Button
            size="sm"
            variant="ghost"
            iconStart="add"
            aria-label={`Add person to ${group.label}`}
            aria-disabled={full ? true : undefined}
            aria-describedby={full ? fullId : undefined}
            className={styles['addPerson']}
            onClick={() => {
              if (!full) onAddPerson();
            }}
          >
            Add person
          </Button>
          {full && (
            <span id={fullId} className={styles['groupNote']}>
              Full: up to {String(group.maxPeople)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Grip({ label }: { readonly label: string }) {
  const handle = useSortableHandle();
  if (handle.disabled) return null;
  return (
    <CardSlotDragHandle
      ref={handle.ref}
      {...handle.props}
      label={label}
      className={styles['grip']}
    />
  );
}

export interface BeatRowProps {
  readonly beat: BeatDraft;
  readonly index: number;
  readonly total: number;
  /** The catalog entry for `beat.beatKey`; undefined when the angle type does not allow it. */
  readonly option: BeatOption | undefined;
  readonly beatOptions: readonly BeatOption[];
  /** The row is past the slot's limit and will not run. */
  readonly overLimit: boolean;
  readonly score: BeatScore | undefined;
  readonly disabled: boolean;
  readonly canRemove: boolean;
  readonly headingLevel: BeatHeadingLevel;
  readonly personExtras: ((person: PersonChip, beatIndex: number) => ReactNode) | undefined;
  readonly onChangeKey: (beatKey: string) => void;
  readonly onAddPerson: (group: BeatGroupNumber) => void;
  readonly onRemovePerson: (group: BeatGroupNumber, person: PersonChip) => void;
  readonly onMove: (direction: MoveDirection) => void;
  readonly onRemove: () => void;
}

/** One beat: grip, position, beat picker, groups of people, score and the row's actions. */
export function BeatRow({
  beat,
  index,
  total,
  option,
  beatOptions,
  overLimit,
  score,
  disabled,
  canRemove,
  headingLevel,
  personExtras,
  onChangeKey,
  onAddPerson,
  onRemovePerson,
  onMove,
  onRemove,
}: BeatRowProps) {
  const Heading = HEADING_TAGS[headingLevel];
  const name = beatNameOf(option);
  const position = `Beat ${String(index + 1)}`;
  const selectOptions: SelectOption[] = beatOptions.map((beatOption) => ({
    value: beatOption.key,
    label: beatOption.name,
  }));
  if (option === undefined) {
    selectOptions.push({ value: beat.beatKey, label: 'Not allowed here', disabled: true });
  }
  const groups = option?.groups ?? [];

  return (
    <div className={classNames(styles['row'], overLimit && styles['rowOver'])}>
      {!disabled && (
        <div className={styles['gripCell']}>
          <Grip label={`Move ${position.toLowerCase()}, ${name}`} />
        </div>
      )}
      <div className={styles['heading']}>
        <Heading className={styles['position']}>{position}</Heading>
        {option?.physical === true && <Badge tone="prestige">Physical</Badge>}
        {overLimit && <Badge tone="negative">Will not run</Badge>}
      </div>
      <div className={styles['pick']}>
        <Select
          label={`${position}: which beat`}
          hideLabel
          options={selectOptions}
          value={beat.beatKey}
          disabled={disabled}
          className={classNames(styles['select'])}
          onValueChange={onChangeKey}
        />
        <p className={styles['hint']}>
          {option?.description ?? 'This angle cannot use this beat. Pick another.'}
        </p>
      </div>
      {score !== undefined && (
        <div className={styles['score']}>
          <span className={styles['scoreLabel']}>Score</span>
          <Explained value={Math.round(score.value)} label={`${name} score`} trace={score.trace} />
        </div>
      )}
      <div className={styles['groups']}>
        {groups.map((group, groupIndex) => {
          const groupNumber: BeatGroupNumber = groupIndex === 0 ? 1 : 2;
          const people = groupNumber === 1 ? beat.groupOne : beat.groupTwo;
          return (
            <BeatGroupView
              key={group.label}
              beatIndex={index}
              group={group}
              people={people}
              disabled={disabled}
              personExtras={personExtras}
              onAddPerson={() => {
                onAddPerson(groupNumber);
              }}
              onRemovePerson={(person) => {
                onRemovePerson(groupNumber, person);
              }}
            />
          );
        })}
      </div>
      {!disabled && (
        <div className={styles['actions']}>
          <IconButton
            icon="up"
            label={`Move ${name} up`}
            data-move="up"
            className={styles['move']}
            disabled={index === 0}
            onClick={() => {
              onMove('up');
            }}
          />
          <IconButton
            icon="down"
            label={`Move ${name} down`}
            data-move="down"
            className={styles['move']}
            disabled={index === total - 1}
            onClick={() => {
              onMove('down');
            }}
          />
          <IconButton
            icon="trash"
            label={`Remove ${position.toLowerCase()}, ${name}`}
            disabled={!canRemove}
            onClick={onRemove}
          />
        </div>
      )}
    </div>
  );
}
