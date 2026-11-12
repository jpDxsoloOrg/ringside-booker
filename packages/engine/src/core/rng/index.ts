/** Public surface of the seeded RNG. See `docs/design/determinism.md`. */

export { WARM_UP_DRAWS, seedState, type RngStateWords } from './prng';
export {
  RngRegistry,
  detachedStream,
  parseRngState,
  rngStateSchema,
  type RngSnapshot,
  type RngState,
  type RngStream,
} from './registry';
export {
  STREAM_NAME_PATTERN,
  assertStreamName,
  isStreamName,
  type StreamName,
  type StreamNames,
} from './streams';
export {
  chance,
  clampedNormal,
  floatBetween,
  intBetween,
  normal,
  oneIn,
  percent,
  pick,
  shuffle,
  weightedPick,
  weightedPickEntry,
  type WeightedEntry,
  type WeightedPickResult,
} from './odds';
export {
  rollChance,
  rollFloat,
  rollInt,
  rollNormal,
  rollOneIn,
  rollPick,
  rollWeighted,
  type RecordedRoll,
  type RollKind,
  type RollRecord,
} from './rolls';
// createIdMinter is deliberately not exported, like createIdFactory: IDs are only minted inside
// world transactions, and the runtime installs the minter on the world from inside the engine.
export { idStreamName, type IdMinter } from './ids';
