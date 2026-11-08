/**
 * What the wizard works out from its draft and the engine's world preview: the season length and
 * season 1 dates, the chosen promotion, the default save name, the local checks each step runs
 * before Next, and the input `startNewGame` gets.
 *
 * Every option and limit comes from the preview (season presets and custom range, settings,
 * founding numbers, taken names), so a new tunable or setting never needs a change here. The
 * length limits on typed names are the engine's own exported input rules, checked here so the
 * player hears about them before submitting; the engine checks everything again.
 */

import {
  addDays,
  compareDates,
  FOUNDED_NAME_MAX_LENGTH,
  FOUNDED_NAME_MIN_LENGTH,
  HEX_COLOR_PATTERN,
  isGameDate,
  PLAYER_NAME_MAX_LENGTH,
  PROMOTION_STYLES,
  SAVE_NAME_MAX_LENGTH,
  SEED_MAX_LENGTH,
  SHORT_NAME_PATTERN,
  year,
} from '@ringside/engine';
import type {
  GameDate,
  NewGameSettingDef,
  PreviewPromotion,
  PreviewRegion,
  SeasonLengthChoice,
  WorldPreview,
} from '@ringside/engine';
import type { StartNewGameInput } from '@/worker/engineHost';
import type { WizardField, WizardIssue } from './issues';
import type { NewGameDraftState } from './useNewGameDraft';
import type { WizardStepId } from './wizardSteps';
import { WIZARD_STEPS } from './wizardSteps';

/** The draft's values, without the store's actions. */
export type DraftSnapshot = Pick<
  NewGameDraftState,
  'rootPackId' | 'player' | 'seasonLength' | 'settings' | 'seed' | 'startDate' | 'playerName'
> & { readonly saveName: string | null };

/** The engine's own input limits, so the wizard's early checks can never drift from them. */
export const FOUNDED_NAME_MIN = FOUNDED_NAME_MIN_LENGTH;
export const FOUNDED_NAME_MAX = FOUNDED_NAME_MAX_LENGTH;
export const SEED_MAX = SEED_MAX_LENGTH;
export const PLAYER_NAME_MAX = PLAYER_NAME_MAX_LENGTH;
export const SAVE_NAME_MAX = SAVE_NAME_MAX_LENGTH;

const DAYS_PER_WEEK = 7;

/** The season length the draft means: its own choice, or the preview's default preset. */
export function seasonChoice(
  draft: Pick<DraftSnapshot, 'seasonLength'>,
  preview: WorldPreview,
): { preset: string } | { customWeeks: string } {
  return draft.seasonLength ?? { preset: preview.seasonLength.defaultPreset };
}

/** Custom weeks as a whole number inside the preview's range, or null when it is not one. */
export function validCustomWeeks(text: string, preview: WorldPreview): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const weeks = Number(trimmed);
  const { min, max } = preview.seasonLength.customWeeks;
  return weeks >= min && weeks <= max ? weeks : null;
}

/** What a custom week count outside the preview's range is told. */
export function customWeeksMessage(preview: WorldPreview): string {
  const { min, max } = preview.seasonLength.customWeeks;
  return `Enter a whole number of weeks from ${String(min)} to ${String(max)}.`;
}

/** The season length in days, or null for custom weeks that are not valid yet. */
export function seasonLengthDays(
  draft: Pick<DraftSnapshot, 'seasonLength'>,
  preview: WorldPreview,
): number | null {
  const choice = seasonChoice(draft, preview);
  if ('preset' in choice) {
    return (
      preview.seasonLength.presets.find((preset) => preset.key === choice.preset)?.lengthDays ??
      null
    );
  }
  const weeks = validCustomWeeks(choice.customWeeks, preview);
  return weeks === null ? null : weeks * DAYS_PER_WEEK;
}

/** "3 months", or "10 weeks" for a custom length; null while custom weeks are invalid. */
export function seasonLengthLabel(
  draft: Pick<DraftSnapshot, 'seasonLength'>,
  preview: WorldPreview,
): string | null {
  const choice = seasonChoice(draft, preview);
  if ('preset' in choice) {
    return (
      preview.seasonLength.presets.find((preset) => preset.key === choice.preset)?.label ?? null
    );
  }
  const weeks = validCustomWeeks(choice.customWeeks, preview);
  return weeks === null ? null : `${String(weeks)} ${weeks === 1 ? 'week' : 'weeks'}`;
}

/** The start date the draft means: its own, when it is a valid date, or the world's. */
export function effectiveStartDate(
  draft: Pick<DraftSnapshot, 'startDate'>,
  preview: WorldPreview,
): GameDate {
  return draft.startDate !== null && isGameDate(draft.startDate)
    ? draft.startDate
    : preview.startDate;
}

export interface SeasonWindow {
  readonly start: GameDate;
  /** The last day of the season: start + length − 1. */
  readonly end: GameDate;
  readonly lengthDays: number;
}

/** Season 1's first and last day, or null while the length is not valid. */
export function seasonOneWindow(draft: DraftSnapshot, preview: WorldPreview): SeasonWindow | null {
  const lengthDays = seasonLengthDays(draft, preview);
  if (lengthDays === null) return null;
  const start = effectiveStartDate(draft, preview);
  return { start, end: addDays(start, lengthDays - 1), lengthDays };
}

/** The promotion chosen from the world, or null when founding one or nothing is chosen yet. */
export function chosenPromotion(
  draft: Pick<DraftSnapshot, 'player'>,
  preview: WorldPreview,
): PreviewPromotion | null {
  if (draft.player.mode !== 'existing' || draft.player.promotionKey === null) return null;
  return preview.promotions.find((row) => row.key === draft.player.promotionKey) ?? null;
}

/** The short name as the engine will store it: trimmed and upper-cased. */
export function normaliseShortName(shortName: string): string {
  return shortName.trim().toUpperCase();
}

/** The short name of the promotion the player will run, or null when none is chosen. */
export function chosenShortName(
  draft: Pick<DraftSnapshot, 'player'>,
  preview: WorldPreview,
): string | null {
  if (draft.player.mode === 'found') {
    const shortName = normaliseShortName(draft.player.found.shortName);
    return shortName === '' ? null : shortName;
  }
  return chosenPromotion(draft, preview)?.shortName ?? null;
}

/** "ASHLAR 2027": the promotion's short name and the start year. */
export function defaultSaveName(draft: DraftSnapshot, preview: WorldPreview): string {
  const startYear = String(year(effectiveStartDate(draft, preview)));
  const shortName = chosenShortName(draft, preview);
  return shortName === null ? `New game ${startYear}` : `${shortName} ${startYear}`;
}

export function effectiveSaveName(draft: DraftSnapshot, preview: WorldPreview): string {
  return draft.saveName ?? defaultSaveName(draft, preview);
}

/** A setting's value in the draft: the player's choice when it suits the setting, else its default. */
export function settingValue(
  definition: NewGameSettingDef,
  settings: DraftSnapshot['settings'],
): boolean | string {
  const value = settings[definition.key];
  if (definition.kind === 'boolean') {
    return typeof value === 'boolean' ? value : definition.default;
  }
  return typeof value === 'string' && (definition.options ?? []).includes(value)
    ? value
    : definition.default;
}

/** The settings whose value differs from their default, in the preview's order. */
export function changedSettings(
  draft: Pick<DraftSnapshot, 'settings'>,
  preview: WorldPreview,
): readonly { readonly definition: NewGameSettingDef; readonly value: boolean | string }[] {
  return preview.settings
    .map((definition) => ({ definition, value: settingValue(definition, draft.settings) }))
    .filter(({ definition, value }) => value !== definition.default);
}

/** The region, its country and its continent for a region key, or null for an unknown key. */
export function findRegion(
  preview: WorldPreview,
  regionKey: string,
): { region: PreviewRegion; countryName: string; continentName: string } | null {
  for (const continent of preview.regions) {
    for (const country of continent.countries) {
      const region = country.regions.find((candidate) => candidate.key === regionKey);
      if (region !== undefined) {
        return { region, countryName: country.name, continentName: continent.name };
      }
    }
  }
  return null;
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function issue(step: WizardStepId, field: WizardField | null, message: string): WizardIssue {
  return { step, field, message };
}

/** Why a short name cannot be used, or null when it can. Checked live as the player types. */
export function shortNameProblem(shortName: string, preview: WorldPreview): string | null {
  const normalised = normaliseShortName(shortName);
  if (normalised === '') return 'Enter a short name.';
  if (!SHORT_NAME_PATTERN.test(normalised)) return 'Use 2 to 8 letters or digits, no spaces.';
  const taken = preview.takenShortNames.find((name) => name === normalised);
  if (taken !== undefined) return `${taken} is already taken by another promotion.`;
  return null;
}

/** Why a promotion name cannot be used, or null when it can. */
export function promotionNameProblem(name: string, preview: WorldPreview): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name for your promotion.';
  if (trimmed.length < FOUNDED_NAME_MIN || trimmed.length > FOUNDED_NAME_MAX) {
    return `Use ${String(FOUNDED_NAME_MIN)} to ${String(FOUNDED_NAME_MAX)} characters.`;
  }
  const taken = preview.takenNames.find((existing) => sameText(existing, trimmed));
  if (taken !== undefined) return `${taken} already exists. Pick another name.`;
  return null;
}

function promotionStepIssues(draft: DraftSnapshot, preview: WorldPreview): WizardIssue[] {
  if (draft.player.mode === 'existing') {
    return chosenPromotion(draft, preview) === null
      ? [issue('promotion', 'promotionKey', 'Choose a promotion to run, or found your own.')]
      : [];
  }
  const { found } = draft.player;
  const issues: WizardIssue[] = [];
  const nameProblem = promotionNameProblem(found.name, preview);
  if (nameProblem !== null) issues.push(issue('promotion', 'name', nameProblem));
  const shortProblem = shortNameProblem(found.shortName, preview);
  if (shortProblem !== null) issues.push(issue('promotion', 'shortName', shortProblem));
  if (findRegion(preview, found.homeRegionKey) === null) {
    issues.push(issue('promotion', 'homeRegionKey', 'Choose a home region.'));
  }
  if (found.style === null) issues.push(issue('promotion', 'style', 'Choose a style.'));
  if (!HEX_COLOR_PATTERN.test(found.color)) {
    issues.push(issue('promotion', 'color', 'Use a hex colour such as #1a2b3c.'));
  }
  return issues;
}

function optionsStepIssues(draft: DraftSnapshot, preview: WorldPreview): WizardIssue[] {
  const issues: WizardIssue[] = [];
  const choice = seasonChoice(draft, preview);
  if ('customWeeks' in choice && validCustomWeeks(choice.customWeeks, preview) === null) {
    issues.push(issue('options', 'customWeeks', customWeeksMessage(preview)));
  }
  const seed = draft.seed.trim();
  if (seed === '' || draft.seed.length > SEED_MAX) {
    issues.push(issue('options', 'seed', `Enter a seed of 1 to ${String(SEED_MAX)} characters.`));
  }
  if (draft.startDate !== null) {
    if (!isGameDate(draft.startDate)) {
      issues.push(issue('options', 'startDate', 'Enter a start date.'));
    } else if (compareDates(draft.startDate, preview.startDate) < 0) {
      issues.push(issue('options', 'startDate', 'The game cannot start before the world does.'));
    }
  }
  return issues;
}

function reviewStepIssues(draft: DraftSnapshot, preview: WorldPreview): WizardIssue[] {
  const issues: WizardIssue[] = [];
  const playerName = draft.playerName.trim();
  if (playerName === '' || playerName.length > PLAYER_NAME_MAX) {
    issues.push(
      issue(
        'review',
        'playerName',
        `Enter your name, up to ${String(PLAYER_NAME_MAX)} characters.`,
      ),
    );
  }
  const saveName = effectiveSaveName(draft, preview).trim();
  if (saveName === '' || saveName.length > SAVE_NAME_MAX) {
    issues.push(
      issue('review', 'saveName', `Enter a save name, up to ${String(SAVE_NAME_MAX)} characters.`),
    );
  }
  return issues;
}

/**
 * The wizard's own checks for one step: the required fields, before Next moves on. The World step
 * needs a world whose preview loaded; the others need that preview to check against.
 */
export function validateStep(
  stepId: WizardStepId,
  draft: DraftSnapshot,
  preview: WorldPreview | null,
): WizardIssue[] {
  if (draft.rootPackId === null || preview === null) {
    return [issue('world', 'rootPackId', 'Choose a world to start in.')];
  }
  switch (stepId) {
    case 'world':
      return [];
    case 'promotion':
      return promotionStepIssues(draft, preview);
    case 'options':
      return optionsStepIssues(draft, preview);
    case 'review':
      return reviewStepIssues(draft, preview);
  }
}

/** Every step's checks, in step order. */
export function validateAllSteps(
  draft: DraftSnapshot,
  preview: WorldPreview | null,
): WizardIssue[] {
  const seen = new Set<string>();
  return WIZARD_STEPS.flatMap((step) => validateStep(step.id, draft, preview)).filter((found) => {
    const key = `${found.step}|${found.field ?? ''}|${found.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function seasonLengthInput(draft: DraftSnapshot, preview: WorldPreview): SeasonLengthChoice {
  const choice = seasonChoice(draft, preview);
  if ('preset' in choice) {
    const preset = preview.seasonLength.presets.find(
      (candidate) => candidate.key === choice.preset,
    );
    return { preset: preset?.key ?? preview.seasonLength.defaultPreset };
  }
  // Sent as typed (when it is a number) so the engine's own range check can answer too.
  return { customWeeks: Number(choice.customWeeks.trim()) };
}

/** The registered settings the draft sets, each with a value that suits it. */
function settingsInput(
  draft: DraftSnapshot,
  preview: WorldPreview,
): Record<string, boolean | string> {
  const settings: Record<string, boolean | string> = {};
  for (const definition of preview.settings) {
    if (Object.hasOwn(draft.settings, definition.key)) {
      settings[definition.key] = settingValue(definition, draft.settings);
    }
  }
  return settings;
}

/** The input `startNewGame` takes. The host fills in the player ID. */
export function buildStartInput(draft: DraftSnapshot, preview: WorldPreview): StartNewGameInput {
  const { player } = draft;
  const { found } = player;
  return {
    rootPackId: draft.rootPackId ?? preview.manifest.id,
    seed: draft.seed,
    ...(draft.startDate !== null && isGameDate(draft.startDate)
      ? { startDate: draft.startDate }
      : {}),
    playerName: draft.playerName.trim(),
    saveName: effectiveSaveName(draft, preview).trim(),
    seasonLength: seasonLengthInput(draft, preview),
    player:
      player.mode === 'existing'
        ? { mode: 'existing', promotionKey: player.promotionKey ?? '' }
        : {
            mode: 'found',
            name: found.name.trim(),
            shortName: normaliseShortName(found.shortName),
            homeRegionKey: found.homeRegionKey,
            style: found.style ?? PROMOTION_STYLES[0],
            size: found.size,
            color: found.color,
            starterKit: found.starterKit,
            weeklyShowDay: found.weeklyShowDay,
          },
    settings: settingsInput(draft, preview),
  };
}
