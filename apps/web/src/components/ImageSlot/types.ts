/** Every kind of entity that can show a picture. Each kind maps to one placeholder generator. */
export type ImageKind = 'person' | 'promotion' | 'title' | 'brand' | 'event' | 'venue' | 'network';

/** The ImageSlot size scale. The rem values live in tokens.css as `--image-size-*`. */
export type ImageSlotSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Metal finish of a championship belt placeholder. */
export type ImageTier = 'gold' | 'silver' | 'bronze' | 'plain';

/** How a person is drawn while they have no real image. A viewer setting will choose this later. */
export type PersonStyle = 'initials' | 'silhouette';

/** The entity an ImageSlot shows. Screens build this from whatever row they already have. */
export interface ImageSubject {
  readonly kind: ImageKind;
  /** Entity id. Placeholder colours and shapes are seeded from it, so a rename keeps them. */
  readonly id: string;
  /** Display name: the accessible name, and the source of initials. */
  readonly name: string;
  /** Short form (a promotion's acronym, a title's short name) used for monograms when present. */
  readonly shortName?: string;
  /**
   * The engine's opaque image reference: a relative asset path, or `placeholder:<kind>`, which
   * means "no image". Only registered resolvers interpret it.
   */
  readonly imageRef?: string;
  /** Belt finish for titles. Ignored by other kinds. */
  readonly tier?: ImageTier;
}

/** Slot sizes in rem, matching the `--image-size-*` tokens. */
export const IMAGE_SLOT_SIZE_REM: Readonly<Record<ImageSlotSize, number>> = {
  xs: 1.5,
  sm: 2,
  md: 3,
  lg: 5,
  xl: 8,
};

/** CSS pixels per rem at the default UI scale, for the intrinsic `width`/`height` of an <img>. */
export const PIXELS_PER_REM = 16;
