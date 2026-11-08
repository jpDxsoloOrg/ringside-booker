/**
 * The colour roles a component can take, from docs/design/visual-identity.md. Each maps to one
 * `--color-*` token, so a tone follows the theme without the component knowing which theme is
 * active, and each hue keeps its one job:
 *
 * - `neutral`: plain text on the surface.
 * - `data`: numbers, meters, links and information (cyan).
 * - `action`: act now, this is live (red-orange).
 * - `prestige`: titles, champions, awards, top picks (gold).
 * - `positive` / `negative`: good and bad outcomes, rising and falling deltas.
 */
export const ROLE_TONES = [
  'neutral',
  'data',
  'action',
  'prestige',
  'positive',
  'negative',
] as const;

export type RoleTone = (typeof ROLE_TONES)[number];

/**
 * Tone names from before the visual identity, kept so existing callers still compile and pick up
 * the new look without a code change. Each one follows a role (see `LEGACY_TONE_ROLES`).
 */
export const LEGACY_TONES = ['info', 'warning', 'accent'] as const;

export type LegacyTone = (typeof LEGACY_TONES)[number];

/** The role each older tone name draws as. */
export const LEGACY_TONE_ROLES: Readonly<Record<LegacyTone, RoleTone>> = {
  info: 'data',
  warning: 'prestige',
  accent: 'action',
};

/** Every tone a component accepts: the roles first, then the older names. */
export const TONES = [...ROLE_TONES, ...LEGACY_TONES] as const;

export type Tone = (typeof TONES)[number];

function isLegacyTone(tone: Tone): tone is LegacyTone {
  return LEGACY_TONES.some((legacyTone) => legacyTone === tone);
}

/** The role a tone draws with: itself for a role, the mapped role for an older name. */
export function toneRole(tone: Tone): RoleTone {
  return isLegacyTone(tone) ? LEGACY_TONE_ROLES[tone] : tone;
}
