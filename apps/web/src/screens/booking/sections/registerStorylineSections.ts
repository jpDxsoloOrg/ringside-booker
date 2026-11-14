/**
 * CRTV4-04: registers the segment editor's Storyline section and the card's storyline chips.
 * Imported once from `./index.ts`.
 */
import { createElement } from 'react';
import { registerCardSlotChips } from '../registries/cardSlotChips';
import { registerSegmentEditorSection } from '../registries/segmentEditorSections';
import { StorylineSlotChips } from './StorylineSlotChips';
import { STORYLINE_SECTION_ID, StorylineEditorSection } from './StorylineEditorSection';

registerSegmentEditorSection({
  id: STORYLINE_SECTION_ID,
  title: 'Storyline',
  order: 50,
  appliesTo: 'both',
  render: (context) => createElement(StorylineEditorSection, { context }),
});

registerCardSlotChips({ id: 'storylines.links', order: 50, Source: StorylineSlotChips });
