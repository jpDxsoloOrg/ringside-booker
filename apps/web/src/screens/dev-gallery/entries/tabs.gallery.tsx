import { TabsDemo } from '../TabsDemo';
import type { GalleryEntry } from '../galleryEntry';

export const galleryEntry: GalleryEntry = {
  id: 'tabs',
  title: 'Tabs',
  group: 'Primitives',
  notes:
    'Automatic and manual activation. On a phone the strip scrolls sideways inside itself instead of wrapping.',
  render: () => <TabsDemo />,
};
