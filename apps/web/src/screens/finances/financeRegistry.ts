import type { ReactNode } from 'react';
import type { FinanceOverview, PromotionId } from '@ringside/engine';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';

/**
 * The Finances screen's two extension points: its tabs and the KPI cards on its Overview. Other
 * features (public image, hype, deals, financial health) add theirs from their own folders with
 * `registerFinanceTab` and `registerFinanceKpi`, without editing the screen. See README.md here.
 */

/** What a finance tab is drawn from. */
export interface FinanceTabProps {
  /** The promotion whose books are shown: the one the local seat runs. */
  readonly promotionId: PromotionId;
}

/** One tab on the Finances screen. */
export interface FinanceTabDefinition {
  /** Unique, and what the URL carries: `?tab=<id>`. Lower-case letters, digits and dashes. */
  readonly id: string;
  /** The words on the tab. */
  readonly label: string;
  /**
   * Its place in the tab strip, lowest first; ties go in the order registered. The built-in tabs
   * use 10 (Overview), 20 (Monthly), 30 (Ledger) and 40 (Policies); see the README for the gaps
   * later features use.
   */
  readonly order: number;
  /** Draws the tab's panel. Only called while the tab is selected, so it may run its own queries. */
  readonly render: (props: FinanceTabProps) => ReactNode;
  /** Return false to leave the tab out. Shown by default. */
  readonly visible?: (props: FinanceTabProps) => boolean;
}

/** What a KPI card on the Overview is drawn from. */
export interface FinanceKpiProps {
  readonly promotionId: PromotionId;
  /** The Overview's `finance.overview` answer. */
  readonly overview: FinanceOverview;
}

/** One KPI card on the Overview tab. */
export interface FinanceKpiDefinition {
  /** Unique, prefixed with the feature for added ones: `eco9.health`. */
  readonly id: string;
  /**
   * Its place in the card grid, lowest first; ties go in the order registered. The built-in cards
   * use 10 (Cash), 20 (This month), 30 (Payroll) and 40 (Company size).
   */
  readonly order: number;
  /** Draws a `KpiCard`, or returns null to leave the card out. */
  readonly render: (props: FinanceKpiProps) => ReactNode;
}

const tabs = createExtensionRegistry<FinanceTabDefinition>('A finance tab');
const kpis = createExtensionRegistry<FinanceKpiDefinition>('A finance KPI');

/** The ids the screen registers itself; a test reset keeps them. */
const builtinIds = new Set<string>();
/** How to take each added (not built-in) definition out again, for the test reset. */
const removers = new Map<string, () => void>();

function tracked<Definition extends { readonly id: string }>(
  kind: 'tab' | 'kpi',
  definition: Definition,
  register: (definition: Definition) => () => void,
): () => void {
  const remove = register(definition);
  const key = `${kind}:${definition.id}`;
  removers.set(key, remove);
  return () => {
    removers.delete(key);
    remove();
  };
}

/**
 * Adds a tab to the Finances screen, in `order` among the others. Returns a function that removes
 * it again; throws when the id is already taken.
 */
export function registerFinanceTab(definition: FinanceTabDefinition): () => void {
  return tracked('tab', definition, tabs.register);
}

/**
 * Adds a KPI card to the Finances Overview, in `order` among the others. Returns a function that
 * removes it again; throws when the id is already taken.
 */
export function registerFinanceKpi(definition: FinanceKpiDefinition): () => void {
  return tracked('kpi', definition, kpis.register);
}

/** For the screen's own tabs and cards (`builtins.tsx`): kept by the test reset. */
export function registerBuiltinFinanceTab(definition: FinanceTabDefinition): void {
  // A module loaded twice (a hot reload in development) keeps the first registration.
  if (builtinIds.has(`tab:${definition.id}`)) return;
  builtinIds.add(`tab:${definition.id}`);
  tabs.register(definition);
}

/** For the screen's own KPI cards (`builtins.tsx`): kept by the test reset. */
export function registerBuiltinFinanceKpi(definition: FinanceKpiDefinition): void {
  if (builtinIds.has(`kpi:${definition.id}`)) return;
  builtinIds.add(`kpi:${definition.id}`);
  kpis.register(definition);
}

/** Every tab, built-in and added, lowest `order` first. Hidden ones are still in it. */
export function listFinanceTabs(): readonly FinanceTabDefinition[] {
  return sortedByOrder(tabs.list());
}

/** Every KPI card, built-in and added, lowest `order` first. */
export function listFinanceKpis(): readonly FinanceKpiDefinition[] {
  return sortedByOrder(kpis.list());
}

/** The tabs in order, kept current as features add and remove theirs. */
export function useFinanceTabs(): readonly FinanceTabDefinition[] {
  return sortedByOrder(tabs.useDefinitions());
}

/** The KPI cards in order, kept current as features add and remove theirs. */
export function useFinanceKpis(): readonly FinanceKpiDefinition[] {
  return sortedByOrder(kpis.useDefinitions());
}

/** Tests only: removes every tab and card a test added, keeping the built-in ones. */
export function resetFinanceRegistryForTests(): void {
  for (const [key, remove] of [...removers]) {
    if (!builtinIds.has(key)) remove();
  }
  removers.clear();
}
