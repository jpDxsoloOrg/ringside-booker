import { memo, useState, useSyncExternalStore } from 'react';
import styles from './ImageSlot.module.css';
import { Belt } from './placeholders/Belt';
import { GenericPlace } from './placeholders/GenericPlace';
import { LogoMark } from './placeholders/LogoMark';
import { PersonInitials } from './placeholders/PersonInitials';
import { PersonSilhouette } from './placeholders/PersonSilhouette';
import type { FrameShape, PlaceholderProps } from './placeholders/shared';
import { getImageResolverVersion, resolveImageUrl, subscribeToImageResolvers } from './resolver';
import { IMAGE_SLOT_SIZE_REM, PIXELS_PER_REM } from './types';
import type { ImageSlotSize, ImageSubject, PersonStyle } from './types';

export interface ImageSlotProps {
  readonly subject: ImageSubject;
  readonly size: ImageSlotSize;
  /** Frame shape. People default to a circle, everything else to a rounded square. */
  readonly shape?: FrameShape;
  /** Hide from assistive tech, for slots that sit next to the entity's name. */
  readonly decorative?: boolean;
  /** How people without an image are drawn: ringed initials (the default) or a silhouette. */
  readonly personStyle?: PersonStyle;
}

/**
 * Image URLs that failed to load in this session. Remembered per URL so a list that re-renders
 * (or a second slot for the same entity) goes straight to the placeholder instead of flickering.
 */
const failedImageUrls = new Set<string>();

/** Forgets failed image URLs. For tests, and for a future "retry images" action. */
export function forgetFailedImageUrls(): void {
  failedImageUrls.clear();
}

const SIZE_CLASSES: Readonly<Record<ImageSlotSize, string | undefined>> = {
  xs: styles['xs'],
  sm: styles['sm'],
  md: styles['md'],
  lg: styles['lg'],
  xl: styles['xl'],
};

function Placeholder({
  personStyle,
  frameShape,
  ...placeholderProps
}: PlaceholderProps & { readonly personStyle: PersonStyle; readonly frameShape: FrameShape }) {
  switch (placeholderProps.subject.kind) {
    case 'person':
      return personStyle === 'silhouette' ? (
        <PersonSilhouette {...placeholderProps} />
      ) : (
        <PersonInitials {...placeholderProps} frameShape={frameShape} />
      );
    case 'title':
      return <Belt {...placeholderProps} />;
    case 'promotion':
    case 'brand':
    case 'event':
    case 'network':
      return <LogoMark {...placeholderProps} />;
    case 'venue':
      return <GenericPlace {...placeholderProps} />;
    default:
      // Data from a pack or an older save may carry a kind this build does not know yet.
      return <GenericPlace {...placeholderProps} />;
  }
}

function ImageSlotView({
  subject,
  size,
  shape,
  decorative = false,
  personStyle = 'initials',
}: ImageSlotProps) {
  // Re-render when an image pack registers or removes a resolver.
  useSyncExternalStore(subscribeToImageResolvers, getImageResolverVersion, getImageResolverVersion);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const url = resolveImageUrl(subject);
  const showImage = url !== null && url !== failedUrl && !failedImageUrls.has(url);
  const frameShape: FrameShape = shape ?? (subject.kind === 'person' ? 'circle' : 'square');
  const frameClass = [styles['slot'], SIZE_CLASSES[size], styles[frameShape]]
    .filter((className) => className !== undefined)
    .join(' ');
  const pixels = IMAGE_SLOT_SIZE_REM[size] * PIXELS_PER_REM;

  return (
    <span className={frameClass} data-kind={subject.kind}>
      {showImage ? (
        <img
          className={styles['image']}
          src={url}
          alt={decorative ? '' : subject.name}
          width={pixels}
          height={pixels}
          loading="lazy"
          decoding="async"
          onError={() => {
            failedImageUrls.add(url);
            setFailedUrl(url);
          }}
        />
      ) : (
        <Placeholder
          subject={subject}
          decorative={decorative}
          personStyle={personStyle}
          frameShape={frameShape}
        />
      )}
    </span>
  );
}

function sameSubject(previous: ImageSubject, next: ImageSubject): boolean {
  return (
    previous.kind === next.kind &&
    previous.id === next.id &&
    previous.name === next.name &&
    previous.shortName === next.shortName &&
    previous.imageRef === next.imageRef &&
    previous.tier === next.tier
  );
}

function sameSlotProps(previous: ImageSlotProps, next: ImageSlotProps): boolean {
  return (
    previous.size === next.size &&
    previous.shape === next.shape &&
    previous.decorative === next.decorative &&
    previous.personStyle === next.personStyle &&
    sameSubject(previous.subject, next.subject)
  );
}

/**
 * The one component that shows a picture of an entity. It asks the registered image resolvers
 * for a URL and shows that image, falling back to a generated placeholder when there is no URL or
 * the image fails to load. Screens use this and never draw entity images themselves.
 *
 * Memoised on the subject's fields rather than its identity, so a list that rebuilds subject
 * objects on every render does not redraw its art.
 */
export const ImageSlot = memo(ImageSlotView, sameSlotProps);
