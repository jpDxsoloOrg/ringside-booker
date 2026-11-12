import type { ReactNode } from 'react';
import type { PersonId, PreviewResult, SimulateResult } from '@ringside/engine';
import { createExtensionRegistry } from '@/components/extensionRegistry';
import type { LabBatch, LabSetup } from './labStore';

/** Where a panel sits: at the bottom of the setup column, or under the result. */
export type LabPanelPlacement = 'setup' | 'result';

/**
 * What a panel is drawn from. Additive: later features add fields (MTCH2-04 added `simulation`), so a
 * panel reads only what it needs. Since MTCH2-07 the lab has one Run: every Run of a match is
 * simulated, and with Runs above 1 the night shown in full is the last of the batch.
 */
export interface LabPanelContext {
  readonly setup: LabSetup;
  /** One list of people per side. */
  readonly sides: readonly (readonly PersonId[])[];
  /** The rating of the night shown in full, or null before the first Run. */
  readonly result: PreviewResult | null;
  /**
   * The same night's winner and finish, or null before the first Run and for a talking segment
   * (and for a match on a save with no finishes). MTCH3's Aftermath and MTCH4's Physical panels
   * read the outcome from it.
   */
  readonly simulation: SimulateResult | null;
  /**
   * The summary of every night when Runs was above 1, else null. A match's batch also counts who
   * won and the finishes (`isSimulateBatch` tells them apart).
   */
  readonly batch: LabBatch | null;
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
