import type { ReactNode } from 'react';
import type { PersonId, PreviewBatchResult, PreviewResult } from '@ringside/engine';
import { createExtensionRegistry } from '@/components/extensionRegistry';
import type { LabSetup } from './labStore';

/** Where a panel sits: at the bottom of the setup column, or under the result. */
export type LabPanelPlacement = 'setup' | 'result';

/**
 * What a panel is drawn from. Additive: later features add fields (MTCH2 adds `simulation`), so a
 * panel reads only what it needs.
 */
export interface LabPanelContext {
  readonly setup: LabSetup;
  /** One list of people per side. */
  readonly sides: readonly (readonly PersonId[])[];
  /** The Run on screen, or null before the first. */
  readonly result: PreviewResult | null;
  /** The Run x100 on screen, or null. */
  readonly batch: PreviewBatchResult | null;
}

/** One titled panel another feature adds to the Match lab. */
export interface LabPanelDefinition {
  /** Unique, such as `mtch3.aftermath`. */
  readonly id: string;
  /** Its place among the panels of its placement, lowest first; ties go by id. */
  readonly order: number;
  /** The panel's heading. */
  readonly title: string;
  /** `result` (the default) under the result; `setup` at the bottom of the setup column. */
  readonly placement?: LabPanelPlacement;
  /** Draws the panel's body. */
  readonly render: (context: LabPanelContext) => ReactNode;
  /** Leaves the panel out when it returns false. Shown always when left out. */
  readonly visible?: (context: LabPanelContext) => boolean;
}

const labPanels = createExtensionRegistry<LabPanelDefinition>('A Match lab panel');

/**
 * Adds a panel to the Match lab without editing the lab. Returns a function that removes it
 * again; throws when the id is already taken. Every open lab re-renders when the list changes.
 * Reserved orders are listed in `apps/web/src/app/README.md`.
 */
export function registerLabPanel(definition: LabPanelDefinition): () => void {
  return labPanels.register(definition);
}

/** Every registered panel, in registration order. */
export function registeredLabPanels(): readonly LabPanelDefinition[] {
  return labPanels.list();
}

/** The registered panels, kept current as features add and remove theirs. */
export function useLabPanels(): readonly LabPanelDefinition[] {
  return labPanels.useDefinitions();
}

/** The panels for one placement that want to show, lowest `order` first, then by id. */
export function labPanelsFor(
  panels: readonly LabPanelDefinition[],
  placement: LabPanelPlacement,
  context: LabPanelContext,
): readonly LabPanelDefinition[] {
  return panels
    .filter((panel) => (panel.placement ?? 'result') === placement)
    .filter((panel) => panel.visible?.(context) ?? true)
    .sort(
      (left, right) =>
        left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}
