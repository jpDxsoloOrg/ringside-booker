/**
 * The four steps of the new-game wizard, in order. The step number (1-4) is what the URL keeps in
 * `?step=`, so browser back and forward move between steps and a reload reopens the same one.
 */

export type WizardStepId = 'world' | 'promotion' | 'options' | 'review';

export interface WizardStep {
  readonly id: WizardStepId;
  /** 1-based, as shown ("Step 2 of 4") and kept in the URL. */
  readonly number: number;
  readonly label: string;
  /** The step's heading, which takes focus when the step opens. */
  readonly heading: string;
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  { id: 'world', number: 1, label: 'World', heading: 'Choose a world' },
  { id: 'promotion', number: 2, label: 'Promotion', heading: 'Choose your promotion' },
  { id: 'options', number: 3, label: 'Options', heading: 'Game options' },
  { id: 'review', number: 4, label: 'Review', heading: 'Review and start' },
];

export const STEP_COUNT = WIZARD_STEPS.length;

/** The search parameter that holds the step number. */
export const STEP_PARAM = 'step';

/** The step with this number. Out-of-range numbers are clamped to the first or last step. */
export function stepByNumber(stepNumber: number): WizardStep {
  const index = Math.min(Math.max(Math.trunc(stepNumber), 1), STEP_COUNT) - 1;
  const step = WIZARD_STEPS[index];
  if (step === undefined) throw new Error(`No wizard step ${String(stepNumber)}`);
  return step;
}

export function stepById(stepId: WizardStepId): WizardStep {
  const step = WIZARD_STEPS.find((candidate) => candidate.id === stepId);
  if (step === undefined) throw new Error(`No wizard step ${stepId}`);
  return step;
}

/** The step a `?step=` value names: its number, or the first step for anything unreadable. */
export function stepFromParam(value: string | null): WizardStep {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? stepByNumber(1) : stepByNumber(parsed);
}
