/** Rows (or cards) shown while a DataTable is loading. */
export const SKELETON_ROW_COUNT = 5;

/** Stable keys for the placeholder rows. */
export const SKELETON_KEYS: readonly string[] = Array.from(
  { length: SKELETON_ROW_COUNT },
  (_, index) => `skeleton-${String(index)}`,
);
