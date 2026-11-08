import { SheetDemo } from '../SheetDemo';
import type { GalleryEntry } from '../galleryEntry';

export const galleryEntry: GalleryEntry = {
  id: 'sheet',
  title: 'Sheet',
  group: 'Overlays',
  notes: 'Every side and size. On a phone each side opens as a bottom sheet with a drag handle.',
  render: () => <SheetDemo />,
};
