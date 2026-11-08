interface GalleryEntry {
  /** Stable key and anchor for the entry. */
  readonly id: string;
  /** Component name as shown in the list. */
  readonly title: string;
}

/** Components register here as they are built, so each one can be checked in isolation. */
const galleryEntries: readonly GalleryEntry[] = [];

/** Dev-only page listing the shared UI components. Not part of release builds. */
export function DevGalleryScreen() {
  return (
    <main>
      <h1>Component gallery</h1>
      {galleryEntries.length === 0 ? (
        <p>No components yet.</p>
      ) : (
        <ul>
          {galleryEntries.map((entry) => (
            <li key={entry.id}>{entry.title}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
