/**
 * New game (WLD-10): the world preview for the wizard, the new-game command, the settings and
 * setup-step registries other systems extend, and founding a promotion.
 *
 * See docs/design/new-game.md.
 */

import './events';
import './streams';

export {
  createNewGame,
  NEW_GAME_REASON_CODES,
  WORLD_CREATED_STEP_ID,
  type NewGameResult,
  type NewGameSummary,
} from './createNewGame';
export {
  foundingValues,
  foundPromotion,
  type FoundingValues,
  type FoundPromotionSpec,
} from './foundPromotion';
export {
  FOUNDING_SIZES,
  newGameInputSchema,
  type ExistingPromotionChoice,
  type FoundingSize,
  type FoundPromotionChoice,
  type NewGameInput,
  type PlayerChoice,
} from './input';
export {
  PREVIEW_SEED,
  PREVIEW_TOP_WORKERS,
  previewWorld,
  type PlaceRef,
  type PopularitySummary,
  type PreviewContinent,
  type PreviewCountry,
  type PreviewPromotion,
  type PreviewRegion,
  type PreviewWorker,
  type WorldPreview,
} from './preview';
export {
  CUSTOM_SEASON_WEEKS_MAX,
  CUSTOM_SEASON_WEEKS_MIN,
  DEFAULT_SEASON_PRESET,
  resolveSeasonLength,
  SEASON_PRESET_KEYS,
  SEASON_PRESETS,
  type SeasonLengthChoice,
  type SeasonPreset,
  type SeasonPresetKey,
} from './season';
export {
  BUILT_IN_SETTINGS,
  getSetting,
  newGameSettingDef,
  newGameSettings,
  registerNewGameSetting,
  WORLD_SETTING_KEYS,
  type NewGameSettingDef,
  type NewGameSettingGroup,
  type NewGameSettingKey,
  type NewGameSettingMap,
  type NewGameSettingValue,
  type ResolvedNewGameSettings,
} from './settings';
export { BUILT_IN_SETUP_STEPS } from './builtinSteps';
export {
  MAX_SETUP_STEP_ORDER,
  registerSetupStep,
  SETUP_STEP_FAILED,
  setupSteps,
  type NewGameSession,
  type SetupContext,
  type SetupStepInfo,
  type SetupStepSpec,
} from './steps';
