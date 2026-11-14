/**
 * MTCH5-06: registers the segment editor's Beats section for talking segments. Imported once from
 * `./index.ts`.
 */
import { createElement } from 'react';
import { registerSegmentEditorSection } from '../registries/segmentEditorSections';
import { BEATS_SECTION_ID, BEATS_SECTION_TITLE, BeatsSection } from './BeatsSection';

registerSegmentEditorSection({
  id: BEATS_SECTION_ID,
  title: BEATS_SECTION_TITLE,
  order: 20,
  appliesTo: 'angle',
  render: (context) => createElement(BeatsSection, { context }),
});
