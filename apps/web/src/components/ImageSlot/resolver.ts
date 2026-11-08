/**
 * The image resolver registry: the one seam real images plug into.
 *
 * A resolver maps an entity to an image URL, or returns null to pass. ImageSlot asks the
 * resolvers in registration order and uses the first URL it gets; with none registered (the
 * default), every slot draws its generated placeholder. Image packs pre-index their manifests and
 * register a resolver, so screens never change when real art arrives.
 */
import type { ImageSubject } from './types';

/** Returns a URL for the subject, or null when it has no image for it. Must be synchronous. */
export type ImageResolver = (subject: ImageSubject) => string | null;

interface RegisteredResolver {
  readonly resolver: ImageResolver;
}

const PLACEHOLDER_REF_PREFIX = 'placeholder:';

let registeredResolvers: readonly RegisteredResolver[] = [];
let registryVersion = 0;
const listeners = new Set<() => void>();
const resolversThatFailed = new WeakSet<ImageResolver>();

function registryChanged(): void {
  registryVersion += 1;
  for (const listener of listeners) listener();
}

/** True for the engine's `placeholder:<kind>` references, which mean "no image". */
export function isPlaceholderRef(imageRef: string | undefined): boolean {
  return imageRef?.startsWith(PLACEHOLDER_REF_PREFIX) ?? false;
}

function withoutImageRef({ kind, id, name, shortName, tier }: ImageSubject): ImageSubject {
  return {
    kind,
    id,
    name,
    ...(shortName === undefined ? {} : { shortName }),
    ...(tier === undefined ? {} : { tier }),
  };
}

/**
 * Adds a resolver after the ones already registered. Returns a function that removes exactly this
 * registration (registering the same function twice gives two independent registrations).
 */
export function registerImageResolver(resolver: ImageResolver): () => void {
  const registration: RegisteredResolver = { resolver };
  registeredResolvers = [...registeredResolvers, registration];
  registryChanged();
  return () => {
    const remaining = registeredResolvers.filter((entry) => entry !== registration);
    if (remaining.length === registeredResolvers.length) return;
    registeredResolvers = remaining;
    registryChanged();
  };
}

/**
 * The first URL any resolver returns for the subject, or null for "draw the placeholder".
 * A `placeholder:*` image reference is passed to resolvers as no reference at all. A resolver
 * that throws is skipped; its first failure is logged and later ones are not, so a broken pack
 * cannot flood the console from a long list.
 */
export function resolveImageUrl(subject: ImageSubject): string | null {
  if (registeredResolvers.length === 0) return null;
  const lookup = isPlaceholderRef(subject.imageRef) ? withoutImageRef(subject) : subject;
  for (const { resolver } of registeredResolvers) {
    try {
      const url = resolver(lookup);
      if (url !== null) return url;
    } catch (error: unknown) {
      if (!resolversThatFailed.has(resolver)) {
        resolversThatFailed.add(resolver);
        console.error('An image resolver threw and was skipped.', error);
      }
    }
  }
  return null;
}

/** Subscribes to registry changes (for useSyncExternalStore). Returns the unsubscribe function. */
export function subscribeToImageResolvers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A number that changes whenever a resolver is registered or removed. */
export function getImageResolverVersion(): number {
  return registryVersion;
}
