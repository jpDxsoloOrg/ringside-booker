/**
 * The semantic colour tones a component can take. Each maps to one `--color-*` token, so a tone
 * follows the theme without the component knowing which theme is active.
 */
export const TONES = ['neutral', 'info', 'positive', 'negative', 'warning', 'accent'] as const;

export type Tone = (typeof TONES)[number];
