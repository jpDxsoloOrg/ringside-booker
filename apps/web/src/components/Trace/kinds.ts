/**
 * Which row draws which trace node. Every kind the engine defines (docs/design/calculation-traces.md
 * #node-kinds) has a renderer, and the switch ends in an exhaustive `never` check: a kind added in
 * the engine fails the typecheck here until it has one. There is deliberately no "unknown row"
 * fallback, which would let a new mechanic ship unexplained.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { TraceNode } from '@ringside/engine';
import { ArithmeticRow } from './rows/ArithmeticRow';
import { BranchRow } from './rows/BranchRow';
import { ConstantRow } from './rows/ConstantRow';
import { DecisionRow } from './rows/DecisionRow';
import { FormulaRow } from './rows/FormulaRow';
import { InputRow } from './rows/InputRow';
import { LimitRow } from './rows/LimitRow';
import { NoteRow } from './rows/NoteRow';
import { RollRow } from './rows/RollRow';
import { RoundRow } from './rows/RoundRow';
import { TunableRow } from './rows/TunableRow';
import type { EntityLinkRenderer } from './rows/rowTypes';

export type { TraceNode, EntityRef } from '@ringside/engine';

/** Draws one node's row with the renderer for its kind. */
export function renderTraceRow(
  node: TraceNode,
  renderEntityLink: EntityLinkRenderer,
): ReactElement {
  switch (node.kind) {
    case 'formula':
      return createElement(FormulaRow, { node, renderEntityLink });
    case 'input':
      return createElement(InputRow, { node, renderEntityLink });
    case 'constant':
      return createElement(ConstantRow, { node, renderEntityLink });
    case 'tunable':
      return createElement(TunableRow, { node, renderEntityLink });
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      return createElement(ArithmeticRow, { node, renderEntityLink });
    case 'min':
    case 'max':
    case 'clamp':
      return createElement(LimitRow, { node, renderEntityLink });
    case 'round':
      return createElement(RoundRow, { node, renderEntityLink });
    case 'roll':
      return createElement(RollRow, { node, renderEntityLink });
    case 'branch':
      return createElement(BranchRow, { node, renderEntityLink });
    case 'decision':
      return createElement(DecisionRow, { node, renderEntityLink });
    case 'note':
      return createElement(NoteRow, { node, renderEntityLink });
    default:
      return missingRenderer(node);
  }
}

/** Unreachable while every kind has a case; a new engine kind makes `node` not `never` here. */
function missingRenderer(node: never): never {
  throw new Error(`No row renderer for trace node ${JSON.stringify(node)}`);
}
