import { useId, useState } from 'react';
import { MAX_STORYLINE_MEMBERS, PUSH_LABELS } from '@ringside/engine';
import type { Alignment, PersonId, StorylineMemberOption, StorylineSide } from '@ringside/engine';
import { AlignmentChip } from '@/components/AlignmentChip';
import { IconButton } from '@/components/Button';
import { formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { VisuallyHidden } from '@/components/layout';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { STORYLINE_SIDE_LABELS } from '@/components/StorylineSideChip';
import { FieldError, TextField } from '@/components/TextField';
import { ROLE_WORDS } from './storylineText';
import styles from './StorylineEditor.module.css';

/** One person picked for a storyline, with the side they take in it. */
export interface ChosenMember {
  readonly personId: PersonId;
  readonly name: string;
  readonly side: StorylineSide;
}

/** The side a person starts on: face → Face, heel → Heel, tweener → Neutral. */
export function defaultSideFor(alignment: Alignment): StorylineSide {
  switch (alignment) {
    case 'face':
      return 'face';
    case 'heel':
      return 'heel';
    case 'tweener':
      return 'neutral';
  }
}

/** The options whose name contains `filter`, ignoring case and surrounding spaces. */
export function filterMemberOptions(
  options: readonly StorylineMemberOption[],
  filter: string,
): readonly StorylineMemberOption[] {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return options;
  return options.filter((option) => option.name.toLowerCase().includes(needle));
}

const SIDE_OPTIONS: readonly RadioOption<StorylineSide>[] = (
  ['face', 'heel', 'neutral'] as const
).map((side) => ({ value: side, label: STORYLINE_SIDE_LABELS[side] }));

function storylineCountText(count: number): string {
  if (count === 0) return 'In no storylines';
  return `In ${formatNumber(count)} ${count === 1 ? 'storyline' : 'storylines'}`;
}

/** "Wrestler · Main event · In 2 storylines". */
export function memberOptionFacts(option: StorylineMemberOption): string {
  const facts = [ROLE_WORDS[option.role]];
  if (option.push !== 'none') facts.push(PUSH_LABELS[option.push]);
  facts.push(storylineCountText(option.activeStorylineCount));
  return facts.join(' · ');
}

export interface MemberPickerProps {
  /** `storylines.memberOptions`, or null while it loads. */
  readonly options: readonly StorylineMemberOption[] | null;
  readonly chosen: readonly ChosenMember[];
  readonly onChange: (chosen: readonly ChosenMember[]) => void;
  /** People already in the storyline (Add member): listed, but not pickable. */
  readonly alreadyIn?: readonly PersonId[];
  /** How many more may be picked. `MAX_STORYLINE_MEMBERS` (12) by default. */
  readonly max?: number;
  /** The engine's refusal about the people picked, shown under the picker. */
  readonly error?: string | undefined;
  readonly disabled?: boolean;
}

/**
 * Picks people for a storyline: a filter box over the promotion's people, each row with a
 * placeholder picture, name, job, alignment, push and how many storylines they are already in.
 * Picking someone adds them to the chosen list with a Face / Heel / Neutral choice that starts from
 * their alignment. "N of 12" counts the picks and adding stops at the limit.
 */
export function MemberPicker({
  options,
  chosen,
  onChange,
  alreadyIn = [],
  max = MAX_STORYLINE_MEMBERS,
  error,
  disabled = false,
}: MemberPickerProps) {
  const [filter, setFilter] = useState('');
  const errorId = useId();
  const chosenHeadingId = useId();
  const factsId = useId();
  const full = chosen.length >= max;
  const chosenIds = new Set(chosen.map((member) => member.personId));
  const inStory = new Set(alreadyIn);
  const shown = options === null ? [] : filterMemberOptions(options, filter);

  const add = (option: StorylineMemberOption): void => {
    if (full || chosenIds.has(option.personId)) return;
    onChange([
      ...chosen,
      { personId: option.personId, name: option.name, side: defaultSideFor(option.alignment) },
    ]);
  };
  const remove = (personId: PersonId): void => {
    onChange(chosen.filter((member) => member.personId !== personId));
  };
  const setSide = (personId: PersonId, side: StorylineSide): void => {
    onChange(chosen.map((member) => (member.personId === personId ? { ...member, side } : member)));
  };

  return (
    <div className={styles['picker']}>
      <div className={styles['chosen']}>
        <div className={styles['chosenHeader']}>
          <h3 id={chosenHeadingId} className={styles['pickerHeading']}>
            People
          </h3>
          <span className={styles['counter']} aria-live="polite">
            {formatNumber(chosen.length)} of {formatNumber(max)}
          </span>
        </div>
        {chosen.length === 0 ? (
          <p className={styles['muted']}>Pick people from the list below.</p>
        ) : (
          <ul className={styles['chosenList']} aria-labelledby={chosenHeadingId}>
            {chosen.map((member) => (
              <li key={member.personId} className={styles['chosenRow']}>
                <span className={styles['chosenName']} title={member.name}>
                  {member.name}
                </span>
                <RadioGroup
                  legend={`Side for ${member.name}`}
                  options={SIDE_OPTIONS}
                  value={member.side}
                  layout="row"
                  disabled={disabled}
                  onValueChange={(side) => {
                    setSide(member.personId, side);
                  }}
                  className={styles['sideChoice'] ?? ''}
                />
                <IconButton
                  icon="close"
                  size="sm"
                  variant="ghost"
                  label={`Remove ${member.name}`}
                  disabled={disabled}
                  onClick={() => {
                    remove(member.personId);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <FieldError id={errorId} message={error} />
      </div>
      <TextField
        label="Find a person"
        value={filter}
        onValueChange={setFilter}
        type="search"
        autoComplete="off"
        disabled={disabled}
      />
      {full && (
        <p className={styles['muted']}>
          That&apos;s as many as this storyline can take. Remove someone to pick another.
        </p>
      )}
      {options === null ? (
        <p className={styles['muted']}>Loading people…</p>
      ) : shown.length === 0 ? (
        <p className={styles['muted']}>No one matches.</p>
      ) : (
        <ul className={styles['optionList']} aria-label="People you can add">
          {shown.map((option) => {
            const picked = chosenIds.has(option.personId);
            const already = inStory.has(option.personId);
            return (
              <li key={option.personId}>
                <button
                  type="button"
                  className={styles['optionRow']}
                  disabled={disabled || picked || already || full}
                  aria-describedby={`${factsId}-${option.personId} ${factsId}-${option.personId}-alignment`}
                  onClick={() => {
                    add(option);
                  }}
                >
                  <ImageSlot
                    subject={{
                      kind: 'person',
                      id: option.personId,
                      name: option.name,
                      ...(option.imageRef === null ? {} : { imageRef: option.imageRef }),
                    }}
                    size="sm"
                    decorative
                  />
                  <span className={styles['optionText']}>
                    {/* Named "Add <name>"; the facts and the chip describe it. */}
                    <span className={styles['optionName']}>
                      <VisuallyHidden>Add </VisuallyHidden>
                      {option.name}
                    </span>
                    <span
                      id={`${factsId}-${option.personId}`}
                      className={styles['optionFacts']}
                      aria-hidden="true"
                    >
                      {memberOptionFacts(option)}
                      {picked && ' · Picked'}
                      {already && ' · Already in it'}
                    </span>
                  </span>
                  <span id={`${factsId}-${option.personId}-alignment`} aria-hidden="true">
                    <AlignmentChip alignment={option.alignment} size="sm" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
