import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router-dom';
import type { NewGameSummary, WorldPreview } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { routes } from '@/app/routes';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { Panel } from '@/components/Panel';
import { useIsMobile } from '@/styles/useMediaQuery';
import { buildStartInput, validateAllSteps, validateStep } from './draftModel';
import {
  announcementFor,
  fieldMessage,
  firstStepWithIssue,
  issueFromPackIssue,
  issueFromReason,
  issuesOnStep,
  stepLevelIssues,
} from './issues';
import type { WizardIssue } from './issues';
import styles from './NewGameScreen.module.css';
import { OptionsStep } from './steps/OptionsStep';
import { PromotionStep } from './steps/PromotionStep';
import { ReviewStep } from './steps/ReviewStep';
import { WorldStep } from './steps/WorldStep';
import { generateSeed, useNewGameDraft } from './useNewGameDraft';
import type { NewGameDraftState } from './useNewGameDraft';
import { useNewGameEngine } from './useNewGameEngine';
import type { NewGameEngine, StartOutcome, StartPhase } from './useNewGameEngine';
import { WizardSummary } from './WizardSummary';
import { STEP_COUNT, STEP_PARAM, stepById, stepFromParam, WIZARD_STEPS } from './wizardSteps';
import type { WizardStep, WizardStepId } from './wizardSteps';

/** An unexpected failure while starting: what to show, what "Copy details" copies, and a retry. */
interface StartFailure {
  readonly title: string;
  readonly message: string;
  readonly details: string;
  /** Set when the world was created but not saved: "Try saving again" saves it. */
  readonly unsavedGame: NewGameSummary | null;
}

interface FailurePanelProps {
  readonly failure: StartFailure;
  readonly busy: boolean;
  readonly onRetrySave: (summary: NewGameSummary) => void;
  readonly onDismiss: () => void;
}

/** A dismissible panel for a start that broke, with the details one click from the clipboard. */
function FailurePanel({ failure, busy, onRetrySave, onDismiss }: FailurePanelProps) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyDetails = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(failure.details);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  };
  return (
    <div className={styles['failure']} role="alert">
      <div className={styles['failureText']}>
        <p className={styles['failureTitle']}>
          <Icon name="warning" decorative /> {failure.title}
        </p>
        <p>{failure.message}</p>
        {copied !== 'idle' && (
          <p className={styles['failureNote']}>
            {copied === 'copied'
              ? 'Details copied.'
              : 'Copying is blocked here; select the details below instead.'}
          </p>
        )}
        {copied === 'failed' && <pre className={styles['failureDetails']}>{failure.details}</pre>}
      </div>
      <div className={styles['failureActions']}>
        {failure.unsavedGame !== null && (
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              if (failure.unsavedGame !== null) onRetrySave(failure.unsavedGame);
            }}
          >
            Try saving again
          </Button>
        )}
        <Button
          iconStart="clipboard"
          onClick={() => {
            void copyDetails();
          }}
        >
          Copy details
        </Button>
        <Button variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/** Problems on the step that no field shows, such as a pack the engine could not read. */
function StepIssueList({ issues }: { readonly issues: readonly WizardIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className={styles['stepIssues']} data-testid="step-issues">
      {issues.map((issue, index) => (
        <li key={`${issue.message}-${String(index)}`}>
          <Icon name="warning" size="sm" decorative /> {issue.message}
        </li>
      ))}
    </ul>
  );
}

interface StepRailProps {
  readonly current: WizardStep;
  readonly issues: readonly WizardIssue[];
  readonly disabled: boolean;
  readonly onGoTo: (step: WizardStep) => void;
}

/** The desktop rail: every step, the current one marked, earlier ones one click away. */
function StepRail({ current, issues, disabled, onGoTo }: StepRailProps) {
  return (
    <nav aria-label="New game steps" className={styles['rail']}>
      <ol className={styles['railList']}>
        {WIZARD_STEPS.map((step) => {
          const state =
            step.number < current.number
              ? 'done'
              : step.number === current.number
                ? 'current'
                : 'upcoming';
          const hasIssue = issuesOnStep(issues, step.id).length > 0;
          const content = (
            <>
              <span className={styles['railNumber']} aria-hidden="true">
                {hasIssue ? <Icon name="warning" decorative /> : String(step.number)}
              </span>
              <span className={styles['railLabel']}>
                {step.label}
                {hasIssue && <span className={styles['visuallyHidden']}> (needs attention)</span>}
              </span>
            </>
          );
          return (
            <li
              key={step.id}
              className={styles['railItem']}
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {state === 'done' ? (
                <button
                  type="button"
                  className={styles['railButton']}
                  disabled={disabled}
                  onClick={() => {
                    onGoTo(step);
                  }}
                >
                  {content}
                </button>
              ) : (
                <span className={styles['railButton']}>{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The phone's step header: "Step 2 of 4 · Promotion" over a progress bar. */
function CompactProgress({ current }: { readonly current: WizardStep }) {
  return (
    <div className={styles['compactProgress']} data-testid="wizard-progress">
      <p className={styles['compactLabel']}>
        Step {current.number} of {STEP_COUNT} · {current.label}
      </p>
      <progress
        className={styles['progressBar']}
        value={current.number}
        max={STEP_COUNT}
        aria-hidden="true"
      />
    </div>
  );
}

interface StepBodyProps {
  readonly step: WizardStepId;
  readonly draft: NewGameDraftState;
  readonly engine: NewGameEngine;
  readonly preview: WorldPreview | null;
  readonly phase: StartPhase | null;
  readonly onBackToWorld: () => void;
}

/** The body of the step on screen. Steps after the first need the chosen world's preview. */
function StepBody({ step, draft, engine, preview, phase, onBackToWorld }: StepBodyProps) {
  if (step === 'world') {
    return (
      <WorldStep
        worlds={engine.worlds}
        preview={engine.preview}
        rootPackId={draft.rootPackId}
        onChoose={(rootPackId) => {
          draft.chooseWorld(rootPackId, true);
        }}
        error={fieldMessage(draft.issues, 'rootPackId')}
      />
    );
  }
  if (preview === null) {
    const loading = draft.rootPackId !== null && engine.preview.status === 'loading';
    return (
      <div className={styles['waiting']}>
        <p>{loading ? 'Reading the world…' : 'Choose a world first.'}</p>
        {!loading && <Button onClick={onBackToWorld}>Go to the World step</Button>}
      </div>
    );
  }
  switch (step) {
    case 'promotion':
      return (
        <PromotionStep
          preview={preview}
          player={draft.player}
          issues={draft.issues}
          onChoosePromotion={draft.choosePromotion}
          onFoundMode={(founding) => {
            draft.setPlayerMode(founding ? 'found' : 'existing');
          }}
          onFoundChange={draft.updateFound}
        />
      );
    case 'options':
      return (
        <OptionsStep
          preview={preview}
          draft={draft}
          issues={draft.issues}
          onSeasonLengthChange={draft.setSeasonLength}
          onSettingChange={draft.setSetting}
          onSeedChange={draft.setSeed}
          onNewSeed={() => {
            draft.setSeed(generateSeed());
          }}
          onStartDateChange={draft.setStartDate}
        />
      );
    case 'review':
      return (
        <ReviewStep
          preview={preview}
          draft={draft}
          issues={draft.issues}
          phase={phase}
          onPlayerNameChange={draft.setPlayerName}
          onSaveNameChange={draft.setSaveName}
        />
      );
  }
}

/**
 * The new-game wizard at `/new`: World → Promotion → Options → Review, then Start game.
 *
 * Desktop: a step rail on the left, the step in the middle and a live summary on the right. Phone:
 * one column with a "Step N of 4" header, the summary at the top of the Review step, and Back and
 * Next in a sticky bar at the bottom. The step lives in the URL (`?step=2`), so browser back and
 * forward move between steps and a reload reopens the same step.
 *
 * Next runs the step's own checks; Start runs every step's, then the engine's, and any problem
 * sends the player to the first step that has one, with the field marked and the problem announced.
 * Leaving with unsaved choices asks first.
 */
export function NewGameScreen() {
  useDocumentTitle('New game');
  const draft = useNewGameDraft();
  const [searchParams, setSearchParams] = useSearchParams();
  const step = stepFromParam(searchParams.get(STEP_PARAM));
  const engine = useNewGameEngine(draft.rootPackId);
  const isMobile = useIsMobile();
  const announce = useAnnounce();
  const navigate = useNavigate();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStepRef = useRef(step.number);
  const leavingRef = useRef(false);
  const [phase, setPhase] = useState<StartPhase | null>(null);
  const [failure, setFailure] = useState<StartFailure | null>(null);
  const busy = phase !== null;

  const preview =
    engine.preview.status === 'ready' && engine.preview.rootPackId === draft.rootPackId
      ? engine.preview.preview
      : null;

  const { setStep, chooseWorld, rootPackId } = draft;
  const worlds = engine.worlds;

  // The store mirrors the URL's step, so code outside the screen can read where the player is.
  useEffect(() => {
    setStep(step.number);
  }, [setStep, step.number]);

  // One world bundled: it is the only choice, so it is chosen (without counting as an edit).
  useEffect(() => {
    if (worlds.status !== 'ready' || rootPackId !== null) return;
    const [onlyWorld, ...others] = worlds.packs;
    if (onlyWorld !== undefined && others.length === 0) chooseWorld(onlyWorld.id, false);
  }, [worlds, rootPackId, chooseWorld]);

  // A new step's heading takes focus, so a screen reader reads where the player has arrived.
  useEffect(() => {
    if (shownStepRef.current === step.number) return;
    shownStepRef.current = step.number;
    headingRef.current?.focus({ preventScroll: false });
  }, [step.number]);

  // Switching between choosing and founding replaces the button that was pressed, so focus goes
  // to the step heading instead of falling back to the page.
  const playerMode = draft.player.mode;
  const shownModeRef = useRef(playerMode);
  useEffect(() => {
    if (shownModeRef.current === playerMode) return;
    shownModeRef.current = playerMode;
    headingRef.current?.focus();
  }, [playerMode]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !leavingRef.current &&
      useNewGameDraft.getState().dirty &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  const goToStep = useCallback(
    (target: WizardStep) => {
      setSearchParams({ [STEP_PARAM]: String(target.number) });
    },
    [setSearchParams],
  );

  /** Shows the problems, announces them and opens the first step that has one. */
  const showIssues = useCallback(
    (issues: readonly WizardIssue[]) => {
      draft.setIssues(issues);
      announce(announcementFor(issues));
      const firstStep = firstStepWithIssue(issues);
      if (firstStep !== null && firstStep !== step.id) goToStep(stepById(firstStep));
    },
    [announce, draft, goToStep, step.id],
  );

  const handleOutcome = (outcome: StartOutcome): void => {
    switch (outcome.kind) {
      case 'started':
        draft.rememberChoices();
        leavingRef.current = true;
        navigate(routes.game.office());
        draft.reset();
        return;
      case 'refused':
        showIssues(outcome.reasons.map(issueFromReason));
        return;
      case 'saveFailed':
        setFailure({
          title: 'Your game was created but not saved',
          message: outcome.message,
          details: outcome.message,
          unsavedGame: outcome.summary,
        });
        return;
      case 'error':
        setFailure({
          title: 'The game could not be started',
          message: outcome.message,
          details: outcome.details,
          unsavedGame: null,
        });
    }
  };

  const handleNext = (): void => {
    const stepIssues = validateStep(step.id, draft, preview);
    const otherIssues = draft.issues.filter((issue) => issue.step !== step.id);
    if (stepIssues.length > 0) {
      showIssues([...stepIssues, ...otherIssues]);
      return;
    }
    draft.setIssues(otherIssues);
    goToStep(WIZARD_STEPS[step.number] ?? step);
  };

  const handleStart = async (): Promise<void> => {
    if (engine.preview.status === 'failed') {
      showIssues(engine.preview.issues.map(issueFromPackIssue));
      return;
    }
    const issues = validateAllSteps(draft, preview);
    if (issues.length > 0 || preview === null) {
      showIssues(issues);
      return;
    }
    draft.setIssues([]);
    setFailure(null);
    const outcome = await engine.start(buildStartInput(draft, preview), setPhase);
    setPhase(null);
    handleOutcome(outcome);
  };

  const handleRetrySave = async (summary: NewGameSummary): Promise<void> => {
    setPhase('saving');
    const outcome = await engine.retrySave(summary);
    setPhase(null);
    if (outcome.kind === 'started') setFailure(null);
    handleOutcome(outcome);
  };

  const isLastStep = step.number === STEP_COUNT;
  const stepContent: ReactNode = (
    <StepBody
      step={step.id}
      draft={draft}
      engine={engine}
      preview={preview}
      phase={phase}
      onBackToWorld={() => {
        goToStep(stepById('world'));
      }}
    />
  );
  return (
    <div className={styles['screen']} aria-busy={busy ? true : undefined}>
      <header className={styles['header']}>
        <Link to={routes.title()} className={styles['backLink']}>
          <Icon name="back" size="sm" className={styles['backIcon']} decorative />
          Main menu
        </Link>
        <RouteHeading className={styles['heading']}>New game</RouteHeading>
      </header>

      {isMobile && <CompactProgress current={step} />}

      <div className={styles['layout']}>
        {!isMobile && (
          <StepRail current={step} issues={draft.issues} disabled={busy} onGoTo={goToStep} />
        )}

        <section className={styles['stepPanel']} aria-labelledby={headingId}>
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className={styles['stepHeading']}>
            {step.heading}
          </h2>
          {failure !== null && (
            <FailurePanel
              failure={failure}
              busy={busy}
              onRetrySave={(summary) => {
                void handleRetrySave(summary);
              }}
              onDismiss={() => {
                setFailure(null);
              }}
            />
          )}
          <StepIssueList issues={stepLevelIssues(draft.issues, step.id)} />
          {stepContent}
          <div className={styles['actionBar']} data-testid="wizard-actions">
            <Button
              iconStart="back"
              disabled={step.number === 1 || busy}
              onClick={() => {
                goToStep(WIZARD_STEPS[step.number - 2] ?? step);
              }}
            >
              Back
            </Button>
            {isLastStep ? (
              <Button
                variant="primary"
                loading={busy}
                iconEnd="play"
                onClick={() => {
                  void handleStart();
                }}
              >
                Start game
              </Button>
            ) : (
              <Button variant="primary" iconEnd="chevron-right" onClick={handleNext}>
                Next
              </Button>
            )}
          </div>
        </section>

        {!isMobile && (
          <aside className={styles['summary']} aria-label="Summary">
            <Panel title="Summary" as="div" headingLevel={2}>
              <WizardSummary draft={draft} preview={preview} variant="compact" />
            </Panel>
          </aside>
        )}
      </div>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onClose={() => {
          if (blocker.state === 'blocked') blocker.reset();
        }}
        onConfirm={() => {
          draft.reset();
          if (blocker.state === 'blocked') blocker.proceed();
        }}
        title="Leave the new game?"
        body="The choices you have made so far will be lost."
        confirmLabel="Leave"
        cancelLabel="Keep setting up"
        tone="danger"
      />
    </div>
  );
}
