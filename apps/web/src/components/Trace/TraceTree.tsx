import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { TraceNode } from '@ringside/engine';
import { Button } from '../Button';
import { Cluster } from '../layout';
import { Icon } from '../Icon';
import { classNames } from '../classNames';
import { formatTraceValue } from './formatTraceValue';
import { renderTraceRow } from './kinds';
import { plainEntityLabel } from './rows/rowTypes';
import type { EntityLinkRenderer } from './rows/rowTypes';
import { traceTopLevelNodes } from './traceToText';
import styles from './Trace.module.css';
import { describeTraceNode } from './wording';

/** Groups down to this depth start open; deeper ones start closed. Top-level rows are depth 1. */
export const DEFAULT_OPEN_DEPTH = 2;

export interface TraceTreeProps {
  /** The trace to show. Its label and value are the headline; its steps are the rows. */
  readonly root: TraceNode;
  /** Draws the names of entities that inputs point at. Plain text by default. */
  readonly renderEntityLink?: EntityLinkRenderer;
  /** Starts with the checks that changed nothing on show. False by default. */
  readonly defaultShowAllChecks?: boolean;
}

interface TreeEntry {
  readonly path: string;
  readonly node: TraceNode;
  readonly depth: number;
  readonly parentPath: string | null;
  /** Paths of the children that are shown (checks that changed nothing may be hidden). */
  readonly childPaths: readonly string[];
}

interface TreeModel {
  /** Every shown node by path, whether or not its parent is open. */
  readonly entries: ReadonlyMap<string, TreeEntry>;
  readonly topLevelPaths: readonly string[];
  /** Paths of every shown node that has shown children. */
  readonly groupPaths: readonly string[];
  /** How many nodes the "Show checks that didn't apply" toggle hides. */
  readonly hiddenCheckCount: number;
}

function pathOf(parentPath: string | null, index: number): string {
  return parentPath === null ? String(index) : `${parentPath}.${String(index)}`;
}

function countHiddenChecks(nodes: readonly TraceNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (describeTraceNode(node).hiddenByDefault) count += 1;
    count += countHiddenChecks(node.children ?? []);
  }
  return count;
}

/** Walks the trace once: which nodes are shown, their paths, parents and shown children. */
function buildTreeModel(root: TraceNode, showAllChecks: boolean): TreeModel {
  const entries = new Map<string, TreeEntry>();
  const groupPaths: string[] = [];

  const addLevel = (
    nodes: readonly TraceNode[],
    parentPath: string | null,
    depth: number,
  ): string[] => {
    const shownPaths: string[] = [];
    nodes.forEach((node, index) => {
      if (!showAllChecks && describeTraceNode(node).hiddenByDefault) return;
      const path = pathOf(parentPath, index);
      shownPaths.push(path);
      const childPaths = addLevel(node.children ?? [], path, depth + 1);
      if (childPaths.length > 0) groupPaths.push(path);
      entries.set(path, { path, node, depth, parentPath, childPaths });
    });
    return shownPaths;
  };

  const topLevelNodes = traceTopLevelNodes(root);
  const topLevelPaths = addLevel(topLevelNodes, null, 1);
  return {
    entries,
    topLevelPaths,
    groupPaths,
    hiddenCheckCount: countHiddenChecks(topLevelNodes),
  };
}

/** Groups that start open: every group above {@link DEFAULT_OPEN_DEPTH}. */
function defaultExpanded(root: TraceNode): ReadonlySet<string> {
  const model = buildTreeModel(root, true);
  return new Set(
    model.groupPaths.filter((path) => (model.entries.get(path)?.depth ?? 0) < DEFAULT_OPEN_DEPTH),
  );
}

/** Shown nodes in reading order, skipping the insides of closed groups. */
function visibleOrder(model: TreeModel, expanded: ReadonlySet<string>): string[] {
  const order: string[] = [];
  const visit = (paths: readonly string[]): void => {
    for (const path of paths) {
      order.push(path);
      const entry = model.entries.get(path);
      if (entry !== undefined && expanded.has(path)) visit(entry.childPaths);
    }
  };
  visit(model.topLevelPaths);
  return order;
}

/** The path of the tree item an event came from, unless it came from a link or button inside it. */
function itemPathFromEvent(target: EventTarget): string | null {
  if (!(target instanceof Element)) return null;
  const item = target.closest('[data-trace-path]');
  if (item === null) return null;
  const control = target.closest('a, button');
  if (control !== null && item.contains(control)) return null;
  return item.getAttribute('data-trace-path');
}

interface RowContentProps {
  readonly node: TraceNode;
  readonly renderEntityLink: EntityLinkRenderer;
}

/** A row's words. Memoised per node, so opening a group does not redraw every row. */
const RowContent = memo(function RowContent({ node, renderEntityLink }: RowContentProps) {
  return renderTraceRow(node, renderEntityLink);
});

interface TreeItemProps {
  readonly entry: TreeEntry;
  readonly model: TreeModel;
  readonly expanded: ReadonlySet<string>;
  readonly tabStopPath: string | null;
  readonly idPrefix: string;
  readonly renderEntityLink: EntityLinkRenderer;
}

function TreeItem({
  entry,
  model,
  expanded,
  tabStopPath,
  idPrefix,
  renderEntityLink,
}: TreeItemProps) {
  const isGroup = entry.childPaths.length > 0;
  const isOpen = isGroup && expanded.has(entry.path);
  const labelId = `${idPrefix}-row-${entry.path}`;
  return (
    <li
      role="treeitem"
      aria-level={entry.depth}
      aria-expanded={isGroup ? isOpen : undefined}
      aria-labelledby={labelId}
      aria-selected={entry.path === tabStopPath}
      tabIndex={entry.path === tabStopPath ? 0 : -1}
      data-trace-path={entry.path}
      className={classNames(styles['item'], isGroup && styles['group'])}
    >
      <div className={styles['row']}>
        <span className={styles['chevron']} aria-hidden="true">
          {isGroup && (
            <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size="sm" decorative />
          )}
        </span>
        <span id={labelId} className={styles['rowContent']}>
          <RowContent node={entry.node} renderEntityLink={renderEntityLink} />
        </span>
      </div>
      {isOpen && (
        <ul role="group" className={styles['children']}>
          {entry.childPaths.map((childPath) => {
            const child = model.entries.get(childPath);
            if (child === undefined) return null;
            return (
              <TreeItem
                key={childPath}
                entry={child}
                model={model}
                expanded={expanded}
                tabStopPath={tabStopPath}
                idPrefix={idPrefix}
                renderEntityLink={renderEntityLink}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}

/**
 * A trace as a tree the player can open step by step. The root's value is the headline; its steps
 * are rows, and any step with sub-steps is a group (open down to depth 2 at first). Checks that
 * changed nothing stay hidden behind a toggle.
 *
 * Keyboard: Up and Down move between visible rows, Right opens a group or steps into it, Left
 * closes it or steps out to the parent, Home and End jump, Enter and Space open or close.
 */
export function TraceTree({
  root,
  renderEntityLink = plainEntityLabel,
  defaultShowAllChecks = false,
}: TraceTreeProps) {
  const idPrefix = useId();
  const treeRef = useRef<HTMLUListElement>(null);
  const [showAllChecks, setShowAllChecks] = useState(defaultShowAllChecks);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => defaultExpanded(root));
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  const model = useMemo(() => buildTreeModel(root, showAllChecks), [root, showAllChecks]);
  const order = useMemo(() => visibleOrder(model, expanded), [model, expanded]);

  // The row that takes Tab: the focused one, else its nearest shown ancestor, else the first.
  let tabStopPath: string | null = order[0] ?? null;
  for (
    let path = focusedPath;
    path !== null;
    path = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : null
  ) {
    if (order.includes(path)) {
      tabStopPath = path;
      break;
    }
  }

  const focusItem = useCallback((path: string) => {
    setFocusedPath(path);
    treeRef.current?.querySelector<HTMLElement>(`[data-trace-path="${path}"]`)?.focus();
  }, []);

  const setGroupOpen = useCallback((path: string, open: boolean) => {
    setExpanded((current) => {
      if (current.has(path) === open) return current;
      const next = new Set(current);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const path = itemPathFromEvent(event.target);
    if (path === null) return;
    const entry = model.entries.get(path);
    if (entry === undefined) return;
    const index = order.indexOf(path);
    const isGroup = entry.childPaths.length > 0;
    const isOpen = isGroup && expanded.has(path);
    const moveTo = (target: string | undefined): void => {
      if (target !== undefined) focusItem(target);
    };

    switch (event.key) {
      case 'ArrowDown':
        moveTo(order[index + 1]);
        break;
      case 'ArrowUp':
        moveTo(order[index - 1]);
        break;
      case 'Home':
        moveTo(order[0]);
        break;
      case 'End':
        moveTo(order[order.length - 1]);
        break;
      case 'ArrowRight':
        if (isGroup && !isOpen) setGroupOpen(path, true);
        else if (isOpen) moveTo(entry.childPaths[0]);
        break;
      case 'ArrowLeft':
        if (isOpen) setGroupOpen(path, false);
        else if (entry.parentPath !== null) moveTo(entry.parentPath);
        break;
      case 'Enter':
      case ' ':
        if (isGroup) setGroupOpen(path, !isOpen);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const handleClick = (event: MouseEvent<HTMLUListElement>): void => {
    const path = itemPathFromEvent(event.target);
    if (path === null) return;
    const entry = model.entries.get(path);
    focusItem(path);
    if (entry !== undefined && entry.childPaths.length > 0) {
      setGroupOpen(path, !expanded.has(path));
    }
  };

  const hasGroups = model.groupPaths.length > 0;

  return (
    <div className={styles['tree']}>
      <div className={styles['headline']}>
        <span className={styles['headlineLabel']}>{root.label}</span>
        <span className={classNames(styles['headlineValue'], 'tabular')}>
          {formatTraceValue(root.value, root.unit)}
        </span>
      </div>
      <Cluster gap={2} className={styles['toolbar']}>
        {hasGroups && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setExpanded(new Set(buildTreeModel(root, true).groupPaths));
              }}
            >
              Expand all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setExpanded(new Set());
              }}
            >
              Collapse all
            </Button>
          </>
        )}
        {model.hiddenCheckCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={showAllChecks}
            onClick={() => {
              setShowAllChecks((current) => !current);
            }}
          >
            {`Show checks that didn't apply (${String(model.hiddenCheckCount)})`}
          </Button>
        )}
      </Cluster>
      <ul
        ref={treeRef}
        role="tree"
        aria-label={`Breakdown of ${root.label}`}
        className={styles['treeList']}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      >
        {model.topLevelPaths.map((path) => {
          const entry = model.entries.get(path);
          if (entry === undefined) return null;
          return (
            <TreeItem
              key={path}
              entry={entry}
              model={model}
              expanded={expanded}
              tabStopPath={tabStopPath}
              idPrefix={idPrefix}
              renderEntityLink={renderEntityLink}
            />
          );
        })}
      </ul>
    </div>
  );
}
