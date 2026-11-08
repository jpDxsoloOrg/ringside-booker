import type { ReactNode } from 'react';

/** The gallery's groups, in the order the entry list shows them. */
export const GALLERY_GROUPS = [
  'Tokens',
  'Primitives',
  'Broadcast',
  'Art',
  'Data',
  'Overlays',
  'Engine',
] as const;

export type GalleryGroup = (typeof GALLERY_GROUPS)[number];

/**
 * One gallery entry. Each `entries/*.gallery.tsx` file exports one as `galleryEntry`, and
 * `entries/index.ts` picks the file up on its own: adding the file is the only step.
 */
export interface GalleryEntry {
  /** Stable, unique, kebab-case. It is the `#hash` that deep links to the entry. */
  readonly id: string;
  /** Name in the entry list and the entry's heading. */
  readonly title: string;
  readonly group: GalleryGroup;
  /** Draws the entry. Called as a component child, so it may return components that use hooks. */
  readonly render: () => ReactNode;
  /** A line or two shown above the entry: what to look for, or what is not covered yet. */
  readonly notes?: string;
}

/** Entry ids are lower-case kebab-case so they read cleanly in a URL hash. */
export const GALLERY_ENTRY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function isGalleryGroup(value: unknown): value is GalleryGroup {
  return GALLERY_GROUPS.some((group) => group === value);
}

/** Runtime check for a module's `galleryEntry` export, since the glob cannot type it. */
export function isGalleryEntry(value: unknown): value is GalleryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate: Partial<Record<keyof GalleryEntry, unknown>> = value;
  return (
    typeof candidate.id === 'string' &&
    GALLERY_ENTRY_ID_PATTERN.test(candidate.id) &&
    typeof candidate.title === 'string' &&
    candidate.title !== '' &&
    isGalleryGroup(candidate.group) &&
    typeof candidate.render === 'function' &&
    (candidate.notes === undefined || typeof candidate.notes === 'string')
  );
}
