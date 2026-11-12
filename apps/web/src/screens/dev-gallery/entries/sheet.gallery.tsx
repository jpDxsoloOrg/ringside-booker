import { SheetDemo } from '../SheetDemo';
import type { GalleryEntry } from '../galleryEntry';

export const galleryEntry: GalleryEntry = {
  id: 'sheet',
  title: 'Sheet',
  group: 'Overlays',
  notes:
    'Every side and size. On a phone each side opens as a bottom sheet with a drag handle; phoneHeight="full" fills the phone screen with no handle and a pinned footer, for long forms such as the segment editor.',
  render: () => <SheetDemo />,
};
