/** Public surface of the seeded RNG. See `docs/design/determinism.md`. */

export { WARM_UP_DRAWS, seedState, type RngStateWords } from './prng';
export {
  RngRegistry,
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
