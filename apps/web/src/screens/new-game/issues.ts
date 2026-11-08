/**
 * Problems with the wizard's choices, wherever they come from (the wizard's own checks, the
 * engine's `Reason`s when it refuses a new game, the pack loader's `PackIssue`s), mapped to the step
 * and field they belong to. The screen jumps back to the first step with a problem and shows each
 * message next to its field.
 */

import { formatPackIssue } from '@ringside/engine';
import type { PackIssue, Reason } from '@ringside/engine';
import { WIZARD_STEPS } from './wizardSteps';
import type { WizardStepId } from './wizardSteps';

/** A field of the wizard a problem can point at. Settings are `setting.<key>`. */
export type WizardField =
  | 'rootPackId'
  | 'promotionKey'
  | 'name'
  | 'shortName'
  | 'homeRegionKey'
  | 'style'
  | 'size'
  | 'color'
  | 'starterKit'
  | 'weeklyShowDay'
  | 'customWeeks'
  | 'seed'
  | 'startDate'
  | `setting.${string}`
  | 'playerName'
  | 'saveName';

export interface WizardIssue {
  readonly step: WizardStepId;
  /** The field to mark, or null for a problem with the step as a whole. */
  readonly field: WizardField | null;
  readonly message: string;
}

/** Engine input paths under `player.` and the wizard fields they belong to. */
const PLAYER_FIELDS: Readonly<Record<string, WizardField>> = {
  promotionKey: 'promotionKey',
  name: 'name',
  shortName: 'shortName',
  homeRegionKey: 'homeRegionKey',
  style: 'style',
  size: 'size',
  color: 'color',
  starterKit: 'starterKit',
  weeklyShowDay: 'weeklyShowDay',
};

/** Top-level engine input paths and where they live in the wizard. */
const TOP_LEVEL_FIELDS: Readonly<Record<string, { step: WizardStepId; field: WizardField }>> = {
  rootPackId: { step: 'world', field: 'rootPackId' },
  seed: { step: 'options', field: 'seed' },
  startDate: { step: 'options', field: 'startDate' },
  playerName: { step: 'review', field: 'playerName' },
  saveName: { step: 'review', field: 'saveName' },
};

/** Reason codes that are about the packs, which the World step owns. */
const WORLD_CODES: ReadonlySet<string> = new Set(['packIssue']);

/** Where an engine input path (`player.shortName`, `settings.sandbox`, …) belongs. */
function placeField(field: string): Pick<WizardIssue, 'step' | 'field'> {
  const [head = '', ...rest] = field.split('.');
  const tail = rest.join('.');
  if (head === 'player') {
    const playerField = PLAYER_FIELDS[rest[0] ?? ''];
    return { step: 'promotion', field: playerField ?? null };
  }
  if (head === 'seasonLength') return { step: 'options', field: 'customWeeks' };
  if (head === 'settings') {
    return { step: 'options', field: tail === '' ? null : `setting.${tail}` };
  }
  if (head === 'tunableOverrides') return { step: 'options', field: null };
  const topLevel = TOP_LEVEL_FIELDS[head];
  if (topLevel !== undefined) return topLevel;
  return { step: 'review', field: null };
}

/** The step and field an engine refusal is about. Reasons with no field go to the Review step. */
export function issueFromReason(reason: Reason): WizardIssue {
  if (reason.field !== undefined && reason.field !== '') {
    return { ...placeField(reason.field), message: reason.message };
  }
  if (WORLD_CODES.has(reason.code)) {
    return { step: 'world', field: null, message: reason.message };
  }
  return { step: 'review', field: null, message: reason.message };
}

/** A pack problem belongs to the World step: the chosen world could not be read. */
export function issueFromPackIssue(issue: PackIssue): WizardIssue {
  return { step: 'world', field: null, message: formatPackIssue(issue) };
}

function stepIndex(stepId: WizardStepId): number {
  return WIZARD_STEPS.findIndex((step) => step.id === stepId);
}

/** The earliest step that has a problem, or null when there are none. */
export function firstStepWithIssue(issues: readonly WizardIssue[]): WizardStepId | null {
  let first: WizardStepId | null = null;
  for (const issue of issues) {
    if (first === null || stepIndex(issue.step) < stepIndex(first)) first = issue.step;
  }
  return first;
}

/** The first message for a field, or undefined when it has none. */
export function fieldMessage(
  issues: readonly WizardIssue[],
  field: WizardField,
): string | undefined {
  return issues.find((issue) => issue.field === field)?.message;
}

/** The problems on one step. */
export function issuesOnStep(
  issues: readonly WizardIssue[],
  stepId: WizardStepId,
): readonly WizardIssue[] {
  return issues.filter((issue) => issue.step === stepId);
}

/** What the live region says when the wizard sends the player back to fix something. */
export function announcementFor(issues: readonly WizardIssue[]): string {
  const stepId = firstStepWithIssue(issues);
  if (stepId === null) return '';
  const step = WIZARD_STEPS[stepIndex(stepId)];
  const onStep = issuesOnStep(issues, stepId);
  const count = onStep.length === 1 ? '1 problem' : `${String(onStep.length)} problems`;
  const first = onStep[0]?.message ?? '';
  return `${count} to fix on the ${step?.label ?? stepId} step. ${first}`;
}
