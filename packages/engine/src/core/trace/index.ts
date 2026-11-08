/** Public surface of calculation traces. See `docs/design/calculation-traces.md`. */

export type {
  ArithmeticKind,
  ArithmeticNode,
  BranchNode,
  ClampNode,
  ConsideredOption,
  ConstantNode,
  DecisionNode,
  EntityRef,
  FormulaNode,
  InputNode,
  LimitNode,
  NoteNode,
  RollNode,
  RoundMode,
  RoundNode,
  Traced,
  TraceNode,
  TraceNodeKind,
  TraceNodeOfKind,
  TraceUnit,
  TraceValue,
  TunableNode,
} from './types';
export { TRACE_NODE_KINDS } from './types';
export { startCalc, type Calc, type CalcOptions } from './calc';
export { startDecision, type Decision, type DecisionOptions } from './decision';
export {
  constantOf,
  findTraceNodes,
  inputOf,
  isNodeOfKind,
  mapTraced,
  traced,
  untraced,
  walkTrace,
} from './helpers';
export {
  TRACE_MAX_DEPTH,
  TRACE_MAX_NODES,
  countTraceNodes,
  hiddenStepsLabel,
  isTruncationNote,
  limitTrace,
  traceDepth,
} from './limits';
export { assertTraceReplays, replayTrace } from './replay';
