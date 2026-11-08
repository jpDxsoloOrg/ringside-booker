import type { ComponentType } from 'react';
import styles from './DevGalleryScreen.module.css';
import { ImageSlotDemo } from './ImageSlotDemo';

interface GalleryEntry {
  /** Stable key and anchor for the entry. */
  readonly id: string;
  /** Component name as shown in the list. */
  readonly title: string;
  /** Renders the component's demo. */
  readonly Demo: ComponentType;
}

/** Components register here as they are built, so each one can be checked in isolation. */
const galleryEntries: readonly GalleryEntry[] = [
  { id: 'image-slot', title: 'ImageSlot', Demo: ImageSlotDemo },
];

/** Dev-only page listing the shared UI components. Not part of release builds. */
export function DevGalleryScreen() {
  return (
    <main className={styles['screen']}>
      <h1 className={styles['title']}>Component gallery</h1>
      {galleryEntries.length === 0 ? (
        <p>No components yet.</p>
      ) : (
        <>
          <nav aria-label="Components">
            <ul>
              {galleryEntries.map((entry) => (
                <li key={entry.id}>
                  <a href={`#${entry.id}`}>{entry.title}</a>
                </li>
              ))}
            </ul>
          </nav>
          {galleryEntries.map(({ id, title, Demo }) => (
            <section key={id} id={id} aria-labelledby={`${id}-title`} className={styles['entry']}>
              <h2 id={`${id}-title`} className={styles['entryTitle']}>
                {title}
              </h2>
              <Demo />
            </section>
          ))}
        </>
      )}
    </main>
  );
}
