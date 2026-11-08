import type { WorldPreview } from '@ringside/engine';
import { Panel } from '@/components/Panel';
import { TextField } from '../fields/Fields';
import type { DraftSnapshot } from '../draftModel';
import { effectiveSaveName, PLAYER_NAME_MAX, SAVE_NAME_MAX } from '../draftModel';
import type { WizardIssue } from '../issues';
import { fieldMessage } from '../issues';
import type { StartPhase } from '../useNewGameEngine';
import { WizardSummary } from '../WizardSummary';
import styles from './Steps.module.css';

/** What the busy state says while the worker works. */
export const START_PHASE_TEXT: Readonly<Record<StartPhase, string>> = {
  creating: 'Building the world…',
  saving: 'Saving your new game…',
};

export interface ReviewStepProps {
  readonly preview: WorldPreview;
  readonly draft: DraftSnapshot;
  readonly issues: readonly WizardIssue[];
  /** The start in progress, or null. */
  readonly phase: StartPhase | null;
  readonly onPlayerNameChange: (playerName: string) => void;
  readonly onSaveNameChange: (saveName: string) => void;
}

/**
 * Step 4: everything that will happen, the player's name and the save's name. Start game lives in
 * the wizard's action bar; while it runs, the progress line here says what the worker is doing.
 */
export function ReviewStep({
  preview,
  draft,
  issues,
  phase,
  onPlayerNameChange,
  onSaveNameChange,
}: ReviewStepProps) {
  const generalIssues = issues.filter((issue) => issue.step === 'review' && issue.field === null);
  return (
    <div className={styles['step']}>
      <Panel title="Your new game" headingLevel={3}>
        <WizardSummary draft={draft} preview={preview} variant="full" />
      </Panel>
      <div className={styles['formGrid']}>
        <TextField
          label="Your name"
          value={draft.playerName}
          onValueChange={onPlayerNameChange}
          maxLength={PLAYER_NAME_MAX}
          autoComplete="name"
          hint="Shown as the booker in charge."
          error={fieldMessage(issues, 'playerName')}
        />
        <TextField
          label="Save name"
          value={effectiveSaveName(draft, preview)}
          onValueChange={onSaveNameChange}
          maxLength={SAVE_NAME_MAX}
          autoComplete="off"
          hint="How the game appears in your saved games."
          error={fieldMessage(issues, 'saveName')}
        />
      </div>
      {generalIssues.length > 0 && (
        <ul className={styles['issueList']}>
          {generalIssues.map((issue, index) => (
            <li key={`${issue.message}-${String(index)}`}>{issue.message}</li>
          ))}
        </ul>
      )}
      <p className={styles['progress']} role="status" data-testid="start-progress">
        {phase === null ? '' : START_PHASE_TEXT[phase]}
      </p>
    </div>
  );
}
