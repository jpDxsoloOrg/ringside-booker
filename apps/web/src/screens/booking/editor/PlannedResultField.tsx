import type { MatchOutcome, MethodOption, SegmentDraft } from '@ringside/engine';
import { isContentKey } from '@ringside/engine';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { Select } from '@/components/Select';
import { defaultMethod, sideLabel } from './editorText';
import styles from './SegmentEditor.module.css';

/** The radio values: a side to win, a draw, a no contest, or nothing planned yet. */
type ResultChoice = `side-${string}` | 'draw' | 'noContest' | 'none';

function choiceOf(outcome: MatchOutcome | null): ResultChoice {
  if (outcome === null) return 'none';
  if (outcome.kind === 'win') return `side-${String(outcome.winningSide)}`;
  return outcome.kind;
}

/** A method's name in the list, flagged when it can't move a title that is on the line. */
export function methodLabel(method: MethodOption, titlesOnTheLine: boolean): string {
  return titlesOnTheLine && !method.changesTitles
    ? `${method.name} (titles can't change)`
    : method.name;
}

export interface PlannedResultFieldProps {
  readonly draft: SegmentDraft;
  readonly sideCount: number;
  /** "Side 1: Kai Moreno": each side's name, by stored side. */
  readonly sideNames: readonly string[];
  readonly methods: readonly MethodOption[];
  readonly disabled: boolean;
  readonly invalid: boolean;
  /**
   * True when Random winners decides this show's results (MTCH2): nothing can be planned, so the
   * field only says so.
   */
  readonly randomWinners?: boolean;
  readonly onChange: (outcome: MatchOutcome | null) => void;
}

/** What the Result field says on a Random winners show, in place of the winner choice. */
export const RANDOM_WINNERS_RESULT_TEXT = 'Decided on the night (Random winners)';

/**
 * Who wins and how: a winner (any side), a draw or a no contest, and for a win the method. A new
 * win starts on the first method that can move a title. Talking segments have no result. On a
 * Random winners show the choice is replaced by "Decided on the night (Random winners)".
 */
export function PlannedResultField({
  draft,
  sideCount,
  sideNames,
  methods,
  disabled,
  invalid,
  randomWinners = false,
  onChange,
}: PlannedResultFieldProps) {
  if (draft.kind !== 'match') return null;
  if (randomWinners) {
    return (
      <div className={styles['field']} data-invalid={invalid ? '' : undefined}>
        <p className={styles['legend']}>Result</p>
        <p className={styles['hint']}>{RANDOM_WINNERS_RESULT_TEXT}</p>
      </div>
    );
  }
  const outcome = draft.outcome;
  const titlesOnTheLine = draft.match.titleIds.length > 0;
  const options: RadioOption<ResultChoice>[] = [
    ...Array.from({ length: sideCount }, (_unused, side) => ({
      value: `side-${String(side)}` as const,
      label: sideNames[side] ?? sideLabel(side),
    })),
    { value: 'draw', label: 'Draw' },
    { value: 'noContest', label: 'No contest' },
  ];
  const fallbackMethod = defaultMethod(methods);

  const choose = (choice: ResultChoice): void => {
    if (choice === 'none') {
      onChange(null);
    } else if (choice === 'draw' || choice === 'noContest') {
      onChange({ kind: choice });
    } else {
      const winningSide = Number(choice.slice('side-'.length));
      const methodKey = outcome?.kind === 'win' ? outcome.methodKey : (fallbackMethod?.key ?? null);
      if (methodKey !== null) onChange({ kind: 'win', winningSide, methodKey });
    }
  };

  return (
    <div className={styles['field']} data-invalid={invalid ? '' : undefined}>
      <RadioGroup
        legend="Result"
        description={
          outcome === null
            ? 'Nothing planned yet. Every match needs a result before the card can be locked.'
            : 'The plan for the night. Nothing is written until you save.'
        }
        options={options}
        value={choiceOf(outcome)}
        onValueChange={choose}
        disabled={disabled}
      />
      {outcome?.kind === 'win' && (
        <Select
          label="Method"
          options={methods.map((method) => ({
            value: method.key,
            label: methodLabel(method, titlesOnTheLine),
          }))}
          value={outcome.methodKey}
          disabled={disabled}
          onValueChange={(value) => {
            if (isContentKey(value)) onChange({ ...outcome, methodKey: value });
          }}
        />
      )}
    </div>
  );
}
