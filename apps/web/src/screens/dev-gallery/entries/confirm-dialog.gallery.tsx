import { ConfirmDialogDemo } from '../ConfirmDialogDemo';
import type { GalleryEntry } from '../galleryEntry';

export const galleryEntry: GalleryEntry = {
  id: 'confirm-dialog',
  title: 'ConfirmDialog',
  group: 'Overlays',
  notes: 'Default and danger tones, and an action that fails so the dialog stays open with its error.',
  render: () => <ConfirmDialogDemo />,
};
