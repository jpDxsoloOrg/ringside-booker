/**
 * Vitest setup for the engine project (registered as `setupFiles` in the root vitest.config.ts).
 *
 * Before each test: restart the `TestIds` counters, so IDs and placeholder names start again at
 * `..._0000000001` and `Test Person 001`, and turn write validation for test worlds back on, in
 * case the previous test switched it off.
 */

import { beforeEach } from 'vitest';
import { resetTestIds } from './ids';
import { setTestWriteValidation } from './write-validation';

beforeEach(() => {
  resetTestIds();
  setTestWriteValidation('always');
});
